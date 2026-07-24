/**
 * notifyRfiAssigned
 *
 * Emails the assignee(s) of an RFI when it is raised or when someone is added
 * as an assignee. Renders the `rfi_assigned` template server-side and sends via
 * Resend, tracking each send in email_messages for bounce visibility.
 *
 * Unlike the generic sendEmail function, this does NOT gate on the caller's
 * role — an external subcontractor is explicitly allowed to raise RFIs (see
 * migration 019) and must be able to notify the internal assignee. Instead it
 * authorizes by context: the caller must be internal staff OR a member of the
 * RFI's project team, and it only ever emails addresses that are actually
 * assignees on the RFI row.
 *
 * Input: { rfiId, recipients? }
 *   recipients omitted  → notify all current assignees on the RFI.
 *   recipients provided → notify only those, intersected with the RFI's real
 *                         assignee emails (used by the "add assignee" path).
 * Returns: { success, total, sent, failed, results[] }
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { sendTrackedEmail } from '../_shared/emailLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_URL = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Fallback mirrors DEFAULT_TEMPLATES.rfi_assigned in src/lib/emailTemplates.js —
// edge functions can't import the browser lib, so the default is duplicated here.
const DEFAULT_TEMPLATE = {
  subject: 'New RFI Assigned: {rfi_ref} – {title}',
  body_html: `
<p>Hi <strong>{assignee_name}</strong>,</p>
<p>You have been assigned a new Request for Information.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Project</td><td style="padding:6px 0;font-weight:500;">{project_name}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">RFI Reference</td><td style="padding:6px 0;font-weight:500;">{rfi_ref}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Title</td><td style="padding:6px 0;font-weight:500;">{title}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Priority</td><td style="padding:6px 0;">{priority}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Due Date</td><td style="padding:6px 0;">{due_date}</td></tr>
</table>
<p style="color:#374151;"><strong>Description:</strong><br>{description}</p>
<p style="margin-top:24px;">
  <a href="{url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View &amp; Respond to RFI</a>
</p>`,
};

function applyVars(template: { subject: string; body_html: string }, vars: Record<string, string>) {
  let subject = template.subject || '';
  let body    = template.body_html || '';
  Object.entries(vars).forEach(([k, v]) => {
    const re = new RegExp(`\\{${k}\\}`, 'g');
    subject = subject.replace(re, v ?? '');
    body    = body.replace(re, v ?? '');
  });
  return { subject, body };
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function buildHtml(bodyHtml: string, branding: any = {}) {
  const brand  = branding.brand_colour || '#1a56db';
  const logo   = branding.logo_url
    ? `<div style="margin-bottom:20px;"><img src="${branding.logo_url}" height="40" alt="${branding.company_name || ''}" style="display:block;" /></div>`
    : '';
  const footer = branding.footer_text
    ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">${branding.footer_text.replace(/\n/g, '<br>')}</div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:${brand};height:4px;"></td></tr>
      <tr><td style="padding:32px 40px;">${logo}<div style="font-size:15px;color:#111827;line-height:1.7;">${bodyHtml}</div>${footer}</td></tr>
      <tr><td style="background:${brand};height:2px;"></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const trace = (msg: string) => console.log(`[notifyRfiAssigned] ${msg}`);

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { rfiId, recipients } = await req.json();
    if (!rfiId) {
      return Response.json({ error: 'rfiId is required' }, { status: 400, headers: corsHeaders });
    }

    // Load the RFI, its project, the caller's profile, template and branding.
    const { data: rfi } = await supabaseAdmin.from('rfis').select('*').eq('id', rfiId).single();
    if (!rfi) {
      return Response.json({ error: 'RFI not found' }, { status: 404, headers: corsHeaders });
    }

    const [
      { data: project },
      { data: senderProfile },
      { data: customTemplates },
      { data: brandings },
    ] = await Promise.all([
      supabaseAdmin.from('projects').select('*').eq('id', rfi.project_id).single(),
      supabaseAdmin.from('users').select('role, full_name').eq('id', authUser.id).single(),
      supabaseAdmin.from('email_templates').select('*').eq('template_key', 'rfi_assigned'),
      supabaseAdmin.from('email_branding').select('*'),
    ]);

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404, headers: corsHeaders });
    }

    // Authorize by context (mirrors migration 019's RFI-insert policy): internal
    // staff, or anyone on this project's team — external subcontractors included.
    const callerRole = senderProfile?.role;
    const team: any[] = Array.isArray(project.team) ? project.team : [];
    const onTeam = team.some((m) => m?.user_email?.toLowerCase() === authUser.email?.toLowerCase());
    if (!['admin', 'internal', 'pricing'].includes(callerRole) && !onTeam) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // Build the RFI's real assignee set: assignees[] plus the legacy single field.
    const assigneeMap = new Map<string, { email: string; name: string }>();
    const assignees: any[] = Array.isArray(rfi.assignees) ? rfi.assignees : [];
    for (const a of assignees) {
      if (a?.email) assigneeMap.set(a.email.toLowerCase(), { email: a.email, name: a.name || a.email });
    }
    if (rfi.assigned_to_email && !assigneeMap.has(rfi.assigned_to_email.toLowerCase())) {
      assigneeMap.set(rfi.assigned_to_email.toLowerCase(), {
        email: rfi.assigned_to_email,
        name: rfi.assigned_to_name || rfi.assigned_to_email,
      });
    }

    // Restrict to the requested recipients (if any), intersected with real
    // assignees so a caller can never notify an arbitrary address.
    let targets = [...assigneeMap.values()];
    if (Array.isArray(recipients) && recipients.length > 0) {
      const wanted = new Set(recipients.map((r: string) => (r || '').toLowerCase()));
      targets = targets.filter((t) => wanted.has(t.email.toLowerCase()));
    }

    if (targets.length === 0) {
      trace(`rfi=${rfiId} — no assignees to notify`);
      return Response.json({ success: true, total: 0, sent: 0, failed: 0, results: [] }, { headers: corsHeaders });
    }

    const branding  = brandings?.[0] || {};
    const template  = customTemplates?.[0] || DEFAULT_TEMPLATE;
    const fromName  = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;
    const resend    = new Resend(Deno.env.get('RESEND_API_KEY'));

    const rfiRef = `RFI-${String(rfi.number ?? 0).padStart(3, '0')}`;
    const commonVars = {
      rfi_ref:      rfiRef,
      title:        rfi.title || '',
      project_name: project.name || '',
      priority:     rfi.priority || 'Medium',
      due_date:     rfi.due_date || 'Not set',
      description:  rfi.description || 'No description provided',
      url:          `${APP_URL}/rfis/${rfiId}`,
    };

    const results: any[] = [];
    let sent = 0;
    let failed = 0;

    for (const target of targets) {
      const { subject, body } = applyVars(template, { ...commonVars, assignee_name: target.name });
      const html = buildHtml(body, branding);
      try {
        const messageId = await sendTrackedEmail(
          resend,
          supabaseAdmin,
          { from: fromEmail, to: target.email, subject, html, text: stripHtml(body) },
          { kind: 'rfi_assigned', projectId: rfi.project_id, sentBy: authUser.id },
        );
        sent++;
        trace(`SUCCESS ${target.email} messageId=${messageId}`);
        results.push({ email: target.email, status: 'Sent', messageId });
      } catch (sendErr: any) {
        failed++;
        trace(`FAIL ${target.email} — ${sendErr?.message}`);
        results.push({ email: target.email, status: 'Failed', error: sendErr?.message });
      }
    }

    trace(`COMPLETE rfi=${rfiId} total=${targets.length} sent=${sent} failed=${failed}`);
    return Response.json(
      { success: failed === 0, total: targets.length, sent, failed, results },
      { status: failed > 0 ? 502 : 200, headers: corsHeaders },
    );

  } catch (error: any) {
    console.error(`[notifyRfiAssigned] EXCEPTION: ${error?.message}`, error?.stack);
    return Response.json({ error: error?.message }, { status: 500, headers: corsHeaders });
  }
});
