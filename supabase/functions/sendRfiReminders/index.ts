/**
 * sendRfiReminders — Daily email reminders for RFIs due tomorrow.
 *
 * Sends to: assignees only (NOT the RFI issuer/creator).
 * Triggered by pg_cron. Safe to call manually for testing.
 * Only processes Open RFIs with due_date = tomorrow (NZT).
 *
 * Deploy:  supabase functions deploy sendRfiReminders --no-verify-jwt
 * Cron SQL (run in Supabase SQL editor):
 *   select cron.schedule(
 *     'rfi-reminders-daily',
 *     '0 20 * * *',  -- 8pm UTC = 8am NZT next day
 *     $$select net.http_post(
 *       url := 'https://axrknhdinnjhrjrmwher.supabase.co/functions/v1/sendRfiReminders',
 *       headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb,
 *       body := '{}'::jsonb
 *     )$$
 *   );
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY')!;
const SENDER_EMAIL     = Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
const APP_URL          = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const resend        = new Resend(RESEND_API_KEY);

function buildEmailHtml(bodyHtml: string, branding: any = {}) {
  const brandColour = branding.brand_colour || '#1a56db';
  const logoHtml    = branding.logo_url
    ? `<div style="margin-bottom:20px;"><img src="${branding.logo_url}" alt="Logo" width="${branding.logo_width || 160}" style="max-width:100%;height:auto;" /></div>`
    : '';
  const footerHtml  = branding.footer_text
    ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">${branding.footer_text.replace(/\n/g, '<br>')}</div>`
    : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="background:${brandColour};height:4px;"></td></tr>
<tr><td style="padding:32px 40px;">${logoHtml}<div style="font-size:15px;color:#111827;line-height:1.7;">${bodyHtml}</div>${footerHtml}</td></tr>
<tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></td></tr></table></body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Get branding
    const { data: brandings } = await supabaseAdmin.from('email_branding').select('*').limit(1);
    const branding = brandings?.[0] || {};

    // Get email templates
    const { data: templates } = await supabaseAdmin.from('email_templates').select('*');
    const tpl = (templates ?? []).find((t: any) => t.template_key === 'rfi_assigned') || null;

    // Compute tomorrow in NZT (UTC+12)
    const now = new Date();
    const nztOffset = 12 * 60 * 60 * 1000;
    const tomorrowNZT = new Date(now.getTime() + nztOffset);
    tomorrowNZT.setUTCDate(tomorrowNZT.getUTCDate() + 1);
    const tomorrow = tomorrowNZT.toISOString().split('T')[0];

    console.log(`[sendRfiReminders] Checking RFIs due on ${tomorrow}`);

    // Fetch open RFIs due tomorrow
    const { data: rfis, error: rfisError } = await supabaseAdmin
      .from('rfis')
      .select('id, title, description, due_date, priority, project_id, assignees, assigned_to_email')
      .eq('status', 'Open')
      .eq('due_date', tomorrow);

    if (rfisError) throw new Error(`RFI query failed: ${rfisError.message}`);
    if (!rfis || rfis.length === 0) {
      console.log('[sendRfiReminders] No RFIs due tomorrow');
      return Response.json({ success: true, sent: 0 }, { headers: corsHeaders });
    }

    // Load projects for names
    const projectIds = [...new Set(rfis.map((r: any) => r.project_id))];
    const { data: projects } = await supabaseAdmin
      .from('projects')
      .select('id, name')
      .in('id', projectIds);
    const projectMap = Object.fromEntries((projects ?? []).map((p: any) => [p.id, p.name]));

    let sent = 0;
    let failed = 0;

    for (const rfi of rfis as any[]) {
      // Collect unique assignee emails (assignees array + legacy assigned_to_email)
      const assigneeEmails = new Set<string>();
      if (Array.isArray(rfi.assignees)) {
        rfi.assignees.forEach((a: any) => { if (a.email) assigneeEmails.add(a.email.toLowerCase()); });
      }
      if (rfi.assigned_to_email) assigneeEmails.add(rfi.assigned_to_email.toLowerCase());

      if (assigneeEmails.size === 0) continue;

      // Fetch assignee user records for names
      const { data: assigneeUsers } = await supabaseAdmin
        .from('users')
        .select('email, full_name')
        .in('email', [...assigneeEmails]);
      const userNameMap = Object.fromEntries((assigneeUsers ?? []).map((u: any) => [u.email.toLowerCase(), u.full_name || u.email]));

      const projectName = projectMap[rfi.project_id] || 'Unknown Project';
      const rfiUrl      = `${APP_URL}/rfis/${rfi.id}`;
      const dueFmt      = new Date(rfi.due_date + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });

      for (const email of assigneeEmails) {
        const assigneeName = userNameMap[email] || email;

        const subject = tpl?.subject
          ? tpl.subject.replace(/{assignee_name}/g, assigneeName).replace(/{rfi_ref}/g, 'RFI').replace(/{title}/g, rfi.title)
          : `Reminder: RFI due tomorrow — ${rfi.title}`;

        const bodyHtml = `
<p>Hi <strong>${assigneeName}</strong>,</p>
<p>This is a reminder that the following RFI is due <strong>tomorrow</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Project</td><td style="padding:6px 0;font-weight:500;">${projectName}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Title</td><td style="padding:6px 0;font-weight:500;">${rfi.title}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Priority</td><td style="padding:6px 0;">${rfi.priority || 'Normal'}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">Due Date</td><td style="padding:6px 0;color:#dc2626;font-weight:600;">${dueFmt}</td></tr>
</table>
${rfi.description ? `<p style="color:#374151;"><strong>Description:</strong><br>${rfi.description}</p>` : ''}
<p style="margin-top:24px;">
  <a href="${rfiUrl}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View &amp; Respond to RFI</a>
</p>`;

        try {
          await resend.emails.send({
            from: SENDER_EMAIL,
            to: email,
            subject,
            html: buildEmailHtml(bodyHtml, branding),
          });
          sent++;
          console.log(`[sendRfiReminders] Sent reminder to ${email} for RFI ${rfi.id}`);
        } catch (e: any) {
          failed++;
          console.error(`[sendRfiReminders] Failed to send to ${email}: ${e.message}`);
        }
      }
    }

    return Response.json({ success: true, rfis_checked: rfis.length, sent, failed }, { headers: corsHeaders });
  } catch (err: any) {
    console.error('[sendRfiReminders] Error:', err.message);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
});
