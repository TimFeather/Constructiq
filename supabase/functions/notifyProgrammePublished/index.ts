/**
 * notifyProgrammePublished
 *
 * Sends a "programme published" email to every team member/subcontractor
 * on a project after its schedule is published, optionally attaching the
 * programme PDF (built client-side and passed as base64, since the
 * scheduling engine runs in the browser). When an attachment is present it
 * is archived to the project-files bucket (not the Documents table — see
 * garbageCollectFiles for how the path is kept alive) and every send is
 * tracked in email_messages via sendTrackedEmail.
 *
 * Each recipient assigned to tasks in the next 3 weeks also gets their own
 * list ({my_tasks}). The browser sends the list (upcomingTasks), on the
 * engine's dates, the same ones the PDF shows.
 *
 * Input: { projectId, pdfBase64?, pdfFilename?,
 *          upcomingTasks?: [{ wbs, name, start, finish, emails[] }] }
 * Returns: { success, total, sent, failed, results[], pdfAttached, pdfPath, pdfBytes }
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { sendTrackedEmail } from '../_shared/emailLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const APP_URL = Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app';

// Mirrors MAX_ATTACHMENT_B64 in src/pages/Programme.jsx. The client guard is not
// trustworthy on its own — this is a public-ish endpoint behind a JWT.
const MAX_ATTACHMENT_B64 = 8 * 1024 * 1024;

// Kept in sync with DEFAULT_TEMPLATES.programme_published in
// src/lib/emailTemplates.js.
const DEFAULT_TEMPLATE = {
  subject: 'Programme Updated — {project_name}',
  body_html: `<p>Hi,</p>
<p>The construction programme for <strong>{project_name}</strong> has been updated by {sender_name}.</p>
{pdf_note}
{my_tasks}
<p>Please refer to the latest schedule for current dates, and let us know if you have any questions.</p>
<p style="margin-top:24px;">
  <a href="{login_url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Log in to View Programme</a>
</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
};

// upcomingTasks comes from the browser, so every field is checked and
// escaped. It is only ever shown to recipients this function picks from
// project.team, each seeing only rows that list their own email.
const MAX_UPCOMING_TASKS = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type UpcomingTask = { wbs: string; name: string; start: string; finish: string; emails: string[] };

function readUpcomingTasks(raw: unknown): UpcomingTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_UPCOMING_TASKS)
    .map((t: any) => ({
      wbs:    String(t?.wbs ?? '').slice(0, 30),
      name:   String(t?.name ?? '').slice(0, 200),
      start:  typeof t?.start === 'string' && DATE_RE.test(t.start) ? t.start : '',
      finish: typeof t?.finish === 'string' && DATE_RE.test(t.finish) ? t.finish : '',
      emails: Array.isArray(t?.emails)
        ? t.emails.slice(0, 20).map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean)
        : [],
    }))
    .filter((t) => t.name && t.start && t.finish && t.emails.length);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// 'yyyy-MM-dd' → 'Mon 9 Mar', independent of the server's time zone
function formatDay(d: string) {
  const dt = new Date(`${d}T00:00:00Z`);
  return `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

// One recipient's {my_tasks} block; '' when they have none. "3 weeks" matches
// UPCOMING_TASK_DAYS in src/lib/programme/assignees.js. The list is extra:
// every recipient still gets the same full programme, which the closing line
// says so nobody mistakes their list for the whole schedule.
function myTasksHtml(tasks: UpcomingTask[], pdfAttached: boolean) {
  if (!tasks.length) return '';
  const fullProgramme = pdfAttached
    ? 'These are just your tasks. The full programme is attached.'
    : 'These are just your tasks. The full programme is in ConstructIQ.';
  const cell = 'padding:6px 8px;border-top:1px solid #e5e7eb;vertical-align:top;';
  const rows = tasks.map((t) => {
    const when = t.start === t.finish ? formatDay(t.start) : `${formatDay(t.start)} – ${formatDay(t.finish)}`;
    return `<tr>
  <td style="${cell}color:#6b7280;font-size:12px;white-space:nowrap;">${escapeHtml(t.wbs)}</td>
  <td style="${cell}font-size:14px;">${escapeHtml(t.name)}</td>
  <td style="${cell}font-size:13px;white-space:nowrap;">${when}</td>
</tr>`;
  }).join('\n');
  return `<p style="margin:20px 0 6px;"><strong>Your tasks in the next 3 weeks</strong></p>
<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-bottom:1px solid #e5e7eb;">
${rows}
</table>
<p style="margin:6px 0 0;color:#6b7280;font-size:13px;">${fullProgramme}</p>`;
}

// "Log in to view" CTA appended to customised templates saved before
// {login_url} existed, so every notification has a way into the app.
function loginButtonHtml(url: string, label: string) {
  return `
<p style="margin-top:24px;">
  <a href="${url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">${label}</a>
</p>`;
}

function applyVars(template: { subject: string; body_html: string }, vars: Record<string, string>) {
  let subject = template.subject || '';
  let body    = template.body_html || '';
  Object.entries(vars).forEach(([k, v]) => {
    const re = new RegExp(`\\{${k}\\}`, 'g');
    // Replacer function: values hold user text (task names), and a plain
    // replacement string would treat "$&" etc. in it as patterns.
    subject = subject.replace(re, () => v ?? '');
    body    = body.replace(re, () => v ?? '');
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

    const { projectId, pdfBase64, pdfFilename, upcomingTasks } = await req.json();
    if (!projectId) {
      return Response.json({ error: 'projectId is required' }, { status: 400, headers: corsHeaders });
    }

    let attachmentB64: string | null = null;
    let attachmentName = 'Programme.pdf';
    if (pdfBase64) {
      if (typeof pdfBase64 !== 'string') {
        return Response.json({ error: 'pdfBase64 must be a base64 string' }, { status: 400, headers: corsHeaders });
      }
      if (pdfBase64.startsWith('data:')) {
        return Response.json({ error: 'pdfBase64 must be raw base64, not a data: URI' }, { status: 400, headers: corsHeaders });
      }
      if (pdfBase64.length > MAX_ATTACHMENT_B64) {
        return Response.json({ error: 'Programme PDF is too large to attach' }, { status: 413, headers: corsHeaders });
      }
      if (pdfFilename && !/\.pdf$/i.test(pdfFilename)) {
        return Response.json({ error: 'pdfFilename must end in .pdf' }, { status: 400, headers: corsHeaders });
      }
      attachmentB64 = pdfBase64;
      attachmentName = pdfFilename || 'Programme.pdf';
    }

    trace(`projectId=${projectId} invokedBy=${sender.email} attachment=${!!attachmentB64}`);

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

    // Archive what was sent. Deliberately no `documents` row — this must not
    // appear in the project's Documents tab; the path is recorded on the
    // project_activity row below. Root-level `<ms>-<uuid>.pdf` naming is required
    // for garbageCollectFiles to see and protect it (see its PATH_RE).
    let pdfPath: string | null = null;
    let pdfBytes: number | null = null;
    if (attachmentB64) {
      try {
        const binary = Uint8Array.from(atob(attachmentB64), (c) => c.charCodeAt(0));
        pdfBytes = binary.length;
        const candidate = `${Date.now()}-${crypto.randomUUID()}.pdf`;
        const { error: upErr } = await supabaseAdmin.storage
          .from('project-files')
          .upload(candidate, binary, { contentType: 'application/pdf', upsert: false });
        if (upErr) throw new Error(upErr.message);
        pdfPath = candidate;
        trace(`archived pdf path=${pdfPath} bytes=${pdfBytes}`);
      } catch (archiveErr: any) {
        // Non-fatal: the attachment is sent from the in-memory base64, not from
        // storage, so a failed archive must not block the notification.
        trace(`Archive failed (continuing without it): ${archiveErr?.message}`);
      }
    }

    const loginUrl = `${APP_URL}/projects/${project.id}`;
    const pdfNoteHtml = attachmentB64
      ? '<p>The updated programme is attached to this email as a PDF.</p>'
      : '';

    const upcoming = readUpcomingTasks(upcomingTasks);
    trace(`upcomingTasks=${upcoming.length}`);
    const hasPlaceholder = (key: string) => (template.body_html || '').includes(`{${key}}`);

    // Rendered per recipient: only {my_tasks} differs between them.
    const renderFor = (email: string) => {
      const myTasks = myTasksHtml(upcoming.filter((t) => t.emails.includes(email.toLowerCase())), !!attachmentB64);
      const { subject, body: renderedBody } = applyVars(template, {
        project_name: project.name || '',
        sender_name:  sender.full_name || sender.email || '',
        company_name: branding.company_name || 'ConstructIQ',
        login_url:    loginUrl,
        pdf_note:     pdfNoteHtml,
        // Last, so no later substitution runs over the task names inside it
        my_tasks:     myTasks,
      });
      let bodyHtml = renderedBody;
      // A template row customised in Settings before a placeholder existed has
      // nowhere to substitute it, so append: the recipient's tasks, a way into
      // the app ({login_url}), and a mention of the attachment ({pdf_note}).
      if (myTasks && !hasPlaceholder('my_tasks')) bodyHtml += myTasks;
      if (!hasPlaceholder('login_url')) bodyHtml += loginButtonHtml(loginUrl, 'Log in to View Programme');
      if (pdfNoteHtml && !hasPlaceholder('pdf_note')) bodyHtml += pdfNoteHtml;
      return { subject, html: buildHtml(bodyHtml, branding), hasTasks: !!myTasks };
    };

    const results: any[] = [];
    let sent = 0;
    let failed = 0;
    let withTasks = 0;

    for (const member of recipients) {
      try {
        const { subject, html, hasTasks } = renderFor(member.user_email);
        const payload: Record<string, unknown> = {
          from: fromEmail,
          to:   member.user_email,
          subject,
          html,
        };
        // Everyone gets the same full programme PDF, task list or not.
        if (attachmentB64) {
          // Resend v4 accepts a base64 string directly on `content`.
          payload.attachments = [{ filename: attachmentName, content: attachmentB64 }];
        }
        const messageId = await sendTrackedEmail(resend, supabaseAdmin, payload, {
          kind: 'programme_published',
          projectId,
          sentBy: authUser.id,
        });
        sent++;
        if (hasTasks) withTasks++;
        trace(`SUCCESS ${member.user_email} messageId=${messageId} taskList=${hasTasks}`);
        results.push({ email: member.user_email, status: 'Sent', messageId, taskList: hasTasks });
      } catch (sendErr: any) {
        failed++;
        trace(`FAIL ${member.user_email} — ${sendErr?.message}`);
        results.push({ email: member.user_email, status: 'Failed', error: sendErr?.message });
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
        description: `Programme update published — notified ${sent}/${recipients.length} team member(s)`
                     + `${attachmentB64 ? ' with the programme PDF attached' : ''}`,
        metadata:    {
          sent, failed, total: recipients.length,
          with_task_list: withTasks,
          pdf_attached: !!attachmentB64,
          pdf_filename: attachmentB64 ? attachmentName : null,
          pdf_path:     pdfPath,
          pdf_bytes:    pdfBytes,
        },
        occurred_at: new Date().toISOString(),
      });
    } catch (_) { /* non-fatal */ }

    trace(`COMPLETE — total=${recipients.length} sent=${sent} failed=${failed}`);
    return Response.json(
      { success: true, total: recipients.length, sent, failed, results, log, pdfAttached: !!attachmentB64, pdfPath, pdfBytes },
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
