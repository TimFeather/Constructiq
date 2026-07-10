/**
 * notifyProgrammePublished
 *
 * Sends a "programme published" email to every team member/subcontractor
 * on a project after its schedule is published. All email processing is
 * server-side via Resend, following the sendOutcomeNotifications pattern.
 *
 * Input: { projectId }
 * Returns: { success, total, sent, failed, results[] }
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DEFAULT_TEMPLATE = {
  subject: 'Updated Programme Published — {project_name}',
  body_html: `<p>Hi,</p>
<p>The construction programme for <strong>{project_name}</strong> has just been published by {sender_name}.</p>
<p>The schedule is now locked — please refer to it for current dates and let us know if you have any questions.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
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

  const log: string[] = [];
  const trace = (msg: string) => { console.log(`[notifyProgrammePublished] ${msg}`); log.push(msg); };

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { data: senderProfile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();
    if (!['admin', 'pricing', 'internal'].includes(senderProfile?.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }
    const sender: any = { ...senderProfile, id: authUser.id, email: authUser.email };

    const { projectId } = await req.json();
    if (!projectId) {
      return Response.json({ error: 'projectId is required' }, { status: 400, headers: corsHeaders });
    }

    trace(`projectId=${projectId} invokedBy=${sender.email}`);

    const [
      { data: project },
      { data: customTemplates },
      { data: brandings },
    ] = await Promise.all([
      supabaseAdmin.from('projects').select('*').eq('id', projectId).single(),
      supabaseAdmin.from('email_templates').select('*').eq('template_key', 'programme_published'),
      supabaseAdmin.from('email_branding').select('*'),
    ]);

    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404, headers: corsHeaders });
    }

    const branding  = brandings?.[0] || {};
    const template  = customTemplates?.[0] || DEFAULT_TEMPLATE;
    const fromName  = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;
    const resend    = new Resend(Deno.env.get('RESEND_API_KEY'));

    // Recipients: every team member/subcontractor with an email, deduped.
    const team: any[] = Array.isArray(project.team) ? project.team : [];
    const recipients = [...new Map(
      team
        .filter((m) => m?.user_email)
        .map((m) => [m.user_email.toLowerCase(), m])
    ).values()];

    if (recipients.length === 0) {
      trace('No team members with an email — nothing to send');
      return Response.json({ success: true, total: 0, sent: 0, failed: 0, results: [], log }, { headers: corsHeaders });
    }

    const { subject, body: bodyHtml } = applyVars(template, {
      project_name: project.name || '',
      sender_name:  sender.full_name || sender.email || '',
      company_name: branding.company_name || 'ConstructIQ',
    });
    const html = buildHtml(bodyHtml, branding);

    const results: any[] = [];
    let sent = 0;
    let failed = 0;

    for (const member of recipients) {
      try {
        const result = await resend.emails.send({
          from:    fromEmail,
          to:      member.user_email,
          subject,
          html,
        });
        if (result?.data?.id) {
          sent++;
          trace(`SUCCESS ${member.user_email} messageId=${result.data.id}`);
          results.push({ email: member.user_email, status: 'Sent', messageId: result.data.id });
        } else {
          const errMsg = result?.error?.message || 'Resend did not return a message ID';
          failed++;
          trace(`FAIL ${member.user_email} — ${errMsg}`);
          results.push({ email: member.user_email, status: 'Failed', error: errMsg });
        }
      } catch (sendErr: any) {
        failed++;
        trace(`Resend threw for ${member.user_email}: ${sendErr.message}`);
        results.push({ email: member.user_email, status: 'Failed', error: sendErr.message });
      }
    }

    try {
      await supabaseAdmin.from('project_activity').insert({
        project_id:  projectId,
        entity_type: 'programme',
        entity_id:   null,
        event_type:  'programme_published',
        actor_name:  sender.full_name || 'System',
        actor_email: sender.email || '',
        description: `Programme published — notified ${sent}/${recipients.length} team member(s)`,
        metadata:    { sent, failed, total: recipients.length },
        occurred_at: new Date().toISOString(),
      });
    } catch (_) { /* non-fatal */ }

    trace(`COMPLETE — total=${recipients.length} sent=${sent} failed=${failed}`);
    return Response.json(
      { success: true, total: recipients.length, sent, failed, results, log },
      { headers: corsHeaders }
    );

  } catch (error: any) {
    console.error(`[notifyProgrammePublished] EXCEPTION: ${error.message}`, error.stack);
    return Response.json(
      { error: error.message, stack: error.stack, log },
      { status: 500, headers: corsHeaders }
    );
  }
});
