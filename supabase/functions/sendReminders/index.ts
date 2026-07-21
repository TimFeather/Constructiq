/**
 * sendReminders — Daily reminder engine
 *
 * Checks reminder_settings and sends:
 *   - tender_external: invitees who haven't submitted, X days before closing
 *   - tender_internal: admins/lead, X days before closing
 *   - rfi_reminder:    invitees, X days before questions_date
 *
 * Deduped via reminder_log (unique: type + entity_id + recipient_email)
 * Triggered daily via pg_cron or Supabase scheduled function.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { escapeHtml } from '../_shared/escapeHtml.ts';
import { sendTrackedEmail } from '../_shared/emailLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = Deno.env.get('APP_URL') || Deno.env.get('SITE_URL') || 'https://constructiq-beige.vercel.app';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function buildWrapper(bodyContent: string, branding: any): string {
  const brandColour = branding.brand_colour || '#1a56db';
  const logoHtml = branding.logo_url
    ? `<div style="text-align:center;margin-bottom:20px;"><img src="${branding.logo_url}" alt="${branding.company_name || 'Logo'}" width="160" style="max-width:100%;height:auto;display:inline-block;" /></div>`
    : '';
  const footerHtml = branding.footer_text
    ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.6;">${branding.footer_text.replace(/\n/g, '<br>')}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Email</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;
                      overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr><td style="background:${brandColour};height:4px;"></td></tr>
          <tr>
            <td style="padding:32px 40px;">
              ${logoHtml}
              <div style="font-size:15px;color:#111827;line-height:1.7;">
                ${bodyContent}
              </div>
              ${footerHtml}
            </td>
          </tr>
          <tr><td style="background:${brandColour};height:2px;"></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function replaceVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

async function alreadySent(type: string, entityId: string, email: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('reminder_log')
    .select('id')
    .eq('reminder_type', type)
    .eq('entity_id', entityId)
    .eq('recipient_email', email)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function logSent(type: string, entityId: string, email: string) {
  await supabaseAdmin.from('reminder_log').insert({
    reminder_type: type,
    entity_id: entityId,
    recipient_email: email,
  }).then(() => {});
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Auth: require SERVICE_ROLE_KEY (pg_cron) or admin/pricing JWT (manual trigger)
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const isServiceRole = token === SERVICE_ROLE_KEY;

    if (!isServiceRole) {
      if (!authHeader) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }
      const { data: profile } = await supabaseAdmin.from('users').select('role').eq('id', user.id).single();
      if (!['admin', 'pricing'].includes(profile?.role || '')) {
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
      }
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { headers: corsHeaders });
    }

    const resend = new Resend(RESEND_API_KEY);

    // Load branding + reminder settings + email templates
    const [brandingRes, settingsRes, templatesRes] = await Promise.all([
      supabaseAdmin.from('email_branding').select('*').limit(1).single(),
      supabaseAdmin.from('reminder_settings').select('*'),
      supabaseAdmin.from('email_templates').select('*'),
    ]);

    // These errors used to be destructured away. A failed settings read left
    // settings=[], which skipped every reminder block and still reported
    // success — reminders silently stopped for as long as the fault lasted.
    // "Nothing is configured" and "I cannot read the configuration" must not
    // look the same from the outside.
    if (settingsRes.error) {
      throw new Error(`Could not read reminder_settings: ${settingsRes.error.message}`);
    }
    if (brandingRes.error) {
      console.warn(`[sendReminders] email_branding unreadable, using defaults: ${brandingRes.error.message}`);
    }
    if (templatesRes.error) {
      console.warn(`[sendReminders] email_templates unreadable, using defaults: ${templatesRes.error.message}`);
    }

    const branding: any = brandingRes.data || {};
    const settings: any[] = settingsRes.data || [];
    const templates: any[] = templatesRes.data || [];

    const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
    const fromName    = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail   = `${fromName} <${senderEmail}>`;

    const getSetting = (type: string) => settings.find(s => s.reminder_type === type);
    const getTemplate = (key: string) => templates.find(t => t.template_key === key);

    let totalSent = 0;
    let totalSkipped = 0;

    interface ReminderDetail {
      type: string;
      id: string | null;
      title: string | null;
      days: number | null;
      action: 'sent' | 'skipped';
      reason?: string;
      recipients?: string[];
    }
    const details: ReminderDetail[] = [];

    // ── TENDER EXTERNAL REMINDER ─────────────────────────────────────────────
    const extSetting = getSetting('tender_external');
    if (extSetting?.enabled) {
      const daysB = extSetting.days_before || 2;

      // Find all Issued tenders where closing_date is exactly daysB days away
      const { data: tenders } = await supabaseAdmin
        .from('tenders')
        .select('id, title, tender_number, location, closing_date')
        .eq('status', 'Issued');

      const tpl = getTemplate('tender_reminder_external');

      for (const tender of (tenders || [])) {
        if (!tender.closing_date) continue;
        const days = daysUntil(tender.closing_date);
        if (days < 0 || days > daysB) {
          details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'outside window' });
          continue;
        }

        // Get invitees who haven't submitted
        const { data: invitations } = await supabaseAdmin
          .from('tender_invitations')
          .select('id, token, invitee_email, invitee_name, invitee_id')
          .eq('tender_id', tender.id)
          .in('status', ['Sent', 'Viewed']);

        if (!invitations || invitations.length === 0) {
          details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'no invitees pending' });
        }

        for (const inv of (invitations || [])) {
          if (!inv.invitee_email) continue;
          const logKey = `tender_ext_${tender.id}_${daysB}d`;
          if (await alreadySent(logKey, tender.id, inv.invitee_email)) {
            totalSkipped++;
            details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'already sent (dedup)', recipients: [inv.invitee_email] });
            continue;
          }

          const portalUrl = `${APP_URL}/tender-submit/${inv.token}`;
          const vars: Record<string, string> = {
            invitee_name:    escapeHtml(inv.invitee_name || 'Tenderer'),
            tender_number:   escapeHtml(tender.tender_number || ''),
            title:           escapeHtml(tender.title || ''),
            location:        escapeHtml(tender.location || ''),
            closing_date:    formatDate(tender.closing_date),
            days_remaining:  String(days),
            submission_link: portalUrl,
            sender_name:     escapeHtml(fromName),
            company_name:    escapeHtml(branding.company_name || 'ConstructIQ'),
          };

          const rawBody = tpl?.body_html || `<p>Dear <strong>{invitee_name}</strong>,</p><p>This is a reminder that tender <strong>{tender_number}: {title}</strong> closes in <strong>{days_remaining} day(s)</strong> on {closing_date}.</p><p style="margin-top:24px;"><a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Submit Pricing Now</a></p><p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`;
          const subject = tpl?.subject ? replaceVars(tpl.subject, vars) : `Reminder: ${tender.tender_number} — ${tender.title} closes in ${days} day(s)`;

          try {
            await sendTrackedEmail(
              resend,
              supabaseAdmin,
              { from: fromEmail, to: inv.invitee_email, subject, html: buildWrapper(replaceVars(rawBody, vars), branding) },
              { kind: 'reminder_tender_external', tenderId: tender.id, inviteeId: inv.invitee_id },
            );
            await logSent(logKey, tender.id, inv.invitee_email);
            totalSent++;
            details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'sent', recipients: [inv.invitee_email] });
          } catch (_e) {
            totalSkipped++;
            details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'send error', recipients: [inv.invitee_email] });
          }
        }
      }
    } else {
      details.push({ type: 'tender_ext', id: null, title: null, days: null, action: 'skipped', reason: 'settings disabled' });
    }

    // ── TENDER INTERNAL REMINDER ─────────────────────────────────────────────
    const intSetting = getSetting('tender_internal');
    if (intSetting?.enabled) {
      const daysB = intSetting.days_before || 1;

      const { data: tenders } = await supabaseAdmin
        .from('tenders')
        .select('id, title, tender_number, closing_date, tender_lead_email, created_by_email')
        .eq('status', 'Issued');

      const tpl = getTemplate('tender_reminder_internal');

      for (const tender of (tenders || [])) {
        if (!tender.closing_date) continue;
        const days = daysUntil(tender.closing_date);
        if (days < 0 || days > daysB) {
          details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'outside window' });
          continue;
        }

        // Count submissions + invitees
        const [{ count: subCount }, { count: invCount }] = await Promise.all([
          supabaseAdmin.from('tender_submissions').select('*', { count: 'exact', head: true }).eq('tender_id', tender.id),
          supabaseAdmin.from('tender_invitees').select('*', { count: 'exact', head: true }).eq('tender_id', tender.id),
        ]);

        // Get all admins + tender lead
        const { data: adminUsers } = await supabaseAdmin
          .from('users')
          .select('email, full_name')
          .in('role', ['admin', 'pricing']);

        const recipients = new Set<string>();
        (adminUsers || []).forEach(u => u.email && recipients.add(u.email));
        if (tender.tender_lead_email) recipients.add(tender.tender_lead_email);
        if (tender.created_by_email) recipients.add(tender.created_by_email);

        const adminUrl = `${APP_URL}/tenders/${tender.id}`;
        const logKey = `tender_int_${tender.id}_${daysB}d`;

        if (recipients.size === 0) {
          details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'no invitees pending' });
        }

        for (const email of recipients) {
          if (await alreadySent(logKey, tender.id, email)) {
            totalSkipped++;
            details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'already sent (dedup)', recipients: [email] });
            continue;
          }

          const vars: Record<string, string> = {
            tender_number:    escapeHtml(tender.tender_number || ''),
            title:            escapeHtml(tender.title || ''),
            closing_date:     formatDate(tender.closing_date),
            days_remaining:   String(days),
            submission_count: String(subCount || 0),
            invitee_count:    String(invCount || 0),
            admin_url:        adminUrl,
          };

          const rawBody = tpl?.body_html || `<p>Hi,</p><p>Tender <strong>{tender_number}: {title}</strong> closes in <strong>{days_remaining} day(s)</strong> on {closing_date}.</p><p>{submission_count} of {invitee_count} invitees have submitted.</p><p style="margin-top:24px;"><a href="{admin_url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Tender</a></p>`;
          const subject = tpl?.subject ? replaceVars(tpl.subject, vars) : `Reminder: ${tender.tender_number} — ${tender.title} closes in ${days} day(s)`;

          try {
            await sendTrackedEmail(
              resend,
              supabaseAdmin,
              { from: fromEmail, to: email, subject, html: buildWrapper(replaceVars(rawBody, vars), branding) },
              { kind: 'reminder_tender_internal', tenderId: tender.id },
            );
            await logSent(logKey, tender.id, email);
            totalSent++;
            details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'sent', recipients: [email] });
          } catch (_e) {
            totalSkipped++;
            details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'send error', recipients: [email] });
          }
        }
      }
    } else {
      details.push({ type: 'tender_int', id: null, title: null, days: null, action: 'skipped', reason: 'settings disabled' });
    }

    // ── RFI QUESTIONS DEADLINE REMINDER ──────────────────────────────────────
    const rfiSetting = getSetting('rfi_reminder');
    if (rfiSetting?.enabled) {
      const daysB = rfiSetting.days_before || 1;

      const { data: tenders } = await supabaseAdmin
        .from('tenders')
        .select('id, title, tender_number, questions_date')
        .eq('status', 'Issued')
        .not('questions_date', 'is', null);

      const tpl = getTemplate('rfi_reminder');

      for (const tender of (tenders || [])) {
        if (!tender.questions_date) continue;
        const days = daysUntil(tender.questions_date);
        if (days < 0 || days > daysB) {
          details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'outside window' });
          continue;
        }

        const { data: invitations } = await supabaseAdmin
          .from('tender_invitations')
          .select('id, token, invitee_email, invitee_name, invitee_id')
          .eq('tender_id', tender.id)
          .in('status', ['Sent', 'Viewed']);

        const logKey = `rfi_rem_${tender.id}_${daysB}d`;

        if (!invitations || invitations.length === 0) {
          details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'no invitees pending' });
        }

        for (const inv of (invitations || [])) {
          if (!inv.invitee_email) continue;
          if (await alreadySent(logKey, tender.id, inv.invitee_email)) {
            totalSkipped++;
            details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'already sent (dedup)', recipients: [inv.invitee_email] });
            continue;
          }

          const portalUrl = `${APP_URL}/tender-submit/${inv.token}`;
          const vars: Record<string, string> = {
            invitee_name:   escapeHtml(inv.invitee_name || 'Tenderer'),
            tender_number:  escapeHtml(tender.tender_number || ''),
            title:          escapeHtml(tender.title || ''),
            questions_date: formatDate(tender.questions_date),
            days_remaining: String(days),
            submission_link: portalUrl,
            sender_name:    escapeHtml(fromName),
            company_name:   escapeHtml(branding.company_name || 'ConstructIQ'),
          };

          const rawBody = tpl?.body_html || `<p>Dear <strong>{invitee_name}</strong>,</p><p>This is a reminder that the questions deadline for tender <strong>{tender_number}: {title}</strong> is in <strong>{days_remaining} day(s)</strong> on {questions_date}.</p><p style="margin-top:24px;"><a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Submit a Question</a></p><p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`;
          const subject = tpl?.subject ? replaceVars(tpl.subject, vars) : `Reminder: Questions close in ${days} day(s) — ${tender.tender_number}: ${tender.title}`;

          try {
            await sendTrackedEmail(
              resend,
              supabaseAdmin,
              { from: fromEmail, to: inv.invitee_email, subject, html: buildWrapper(replaceVars(rawBody, vars), branding) },
              { kind: 'reminder_questions_deadline', tenderId: tender.id, inviteeId: inv.invitee_id },
            );
            await logSent(logKey, tender.id, inv.invitee_email);
            totalSent++;
            details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'sent', recipients: [inv.invitee_email] });
          } catch (_e) {
            totalSkipped++;
            details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'send error', recipients: [inv.invitee_email] });
          }
        }
      }
    } else {
      details.push({ type: 'rfi_reminder', id: null, title: null, days: null, action: 'skipped', reason: 'settings disabled' });
    }

    console.log(`[sendReminders] DONE sent=${totalSent} skipped=${totalSkipped}`);
    return Response.json({ success: true, sent: totalSent, skipped: totalSkipped, details }, { headers: corsHeaders });

  } catch (e: any) {
    console.error('[sendReminders] ERROR:', e.message);
    return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
});
