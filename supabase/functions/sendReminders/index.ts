/**
 * sendReminders — Daily reminder engine
 *
 * Checks reminder_settings and sends:
 *   - tender_external: invitees who haven't submitted, X days before closing
 *   - tender_internal: admins/lead, X days before closing
 *   - rfi_reminder:    invitees, X days before questions_date
 *
 * "Closing" means the THS RFT closing date when the tender has one, falling
 * back to closing_date — the same date the invitation email shows.
 *
 * Deduped via reminder_log (unique: type + entity_id + recipient_email)
 * Triggered daily via pg_cron or Supabase scheduled function.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { escapeHtml } from '../_shared/escapeHtml.ts';
import { sendTrackedEmail } from '../_shared/emailLog.ts';
import { daysUntilNZ } from '../_shared/reminderWindow.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app',
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

/** "today" / "tomorrow" / "in N days" for a non-negative days-remaining count. */
function daysLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * A missed reminder is recoverable tomorrow; a mailout loop to
 * subcontractors because dedup silently failed open is not. So a read
 * error here fails CLOSED: treat it as "already sent" rather than "not
 * sent", and surface which case it was so the Phase 1 panel can tell them
 * apart.
 */
async function alreadySent(type: string, entityId: string, email: string): Promise<{ skip: boolean; reason?: string }> {
  const { data, error } = await supabaseAdmin
    .from('reminder_log')
    .select('id')
    .eq('reminder_type', type)
    .eq('entity_id', entityId)
    .eq('recipient_email', email)
    .limit(1);
  if (error) {
    console.warn(`[sendReminders] dedup check failed for ${type}/${email}: ${error.message}`);
    return { skip: true, reason: 'dedup check failed' };
  }
  return { skip: (data?.length ?? 0) > 0, reason: 'already sent (dedup)' };
}

/**
 * If this insert fails silently, the email already went out and nothing
 * recorded it — tomorrow it sends again. Surface the failure to the
 * caller instead of swallowing it.
 */
async function logSent(type: string, entityId: string, email: string): Promise<{ error?: string }> {
  const { error } = await supabaseAdmin.from('reminder_log').insert({
    reminder_type: type,
    entity_id: entityId,
    recipient_email: email,
  });
  if (error) {
    console.error(`[sendReminders] failed to log sent reminder ${type}/${email}: ${error.message}`);
    return { error: error.message };
  }
  return {};
}

/**
 * A portal Decline can't be recorded on tender_invitations — its CHECK
 * constraint only permits ('Sent','Viewed','Submitted'), so a declined
 * sub stays 'Sent' there and would otherwise keep getting nagged. The
 * parallel write to tender_invitees *does* succeed and does allow
 * 'Declined', so this is the only place that fact is visible. (Owned
 * properly by PLAN_APP_AUDIT finding F4 — this is the reminder-side
 * workaround, not the fix.)
 */
async function getDeclinedOrArchived(tenderId: string): Promise<{ ids: Set<string>; emails: Set<string> }> {
  const { data, error } = await supabaseAdmin
    .from('tender_invitees')
    .select('id, email')
    .eq('tender_id', tenderId)
    .in('status', ['Declined', 'Archived']);
  if (error) {
    console.warn(`[sendReminders] could not read tender_invitees for ${tenderId}: ${error.message}`);
    return { ids: new Set(), emails: new Set() };
  }
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const row of (data || [])) {
    ids.add(row.id);
    if (row.email) emails.add(String(row.email).toLowerCase());
  }
  return { ids, emails };
}

/**
 * A run that sends nothing currently leaves no trace at all, so a dead
 * cron and a quiet week are indistinguishable — precisely how this went
 * unnoticed since June. One row per invocation, written at the very end
 * (both the success path and the outer catch), makes that visible in
 * Settings. This must never throw and never block the response — a
 * broken reminder_runs write is not a reason to fail (or re-fail) a
 * reminder send.
 */
async function logRun(trigger: 'cron' | 'manual', result: { sent: number; skipped: number; error?: string; details?: unknown }) {
  try {
    const { error } = await supabaseAdmin.from('reminder_runs').insert({
      trigger,
      sent: result.sent,
      skipped: result.skipped,
      error: result.error ?? null,
      details: result.details ?? null,
    });
    if (error) {
      console.error(`[sendReminders] failed to record reminder_runs row: ${error.message}`);
    }
  } catch (e: any) {
    console.error(`[sendReminders] logRun threw: ${e?.message}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Set as soon as we know it (right after the auth check below) so it's
  // available in the outer catch too — a dead cron and a broken manual
  // trigger should both leave an accurate reminder_runs row.
  let triggerType: 'cron' | 'manual' = 'manual';

  try {
    // Auth: require SERVICE_ROLE_KEY (pg_cron) or admin/pricing JWT (manual trigger)
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const isServiceRole = token === SERVICE_ROLE_KEY;
    triggerType = isServiceRole ? 'cron' : 'manual';

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
    // reminder_settings.send_time is read by nothing here and exposed by
    // nothing in Settings — the pg_cron schedule is the only real control
    // over when this runs. Left in the schema rather than dropped; not
    // worth a migration on its own.
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

      // Each reminder type runs in its own try/catch: a query failure here
      // is load-bearing for THIS type (there is nothing to loop over without
      // it), so it throws — but caught locally, not by the outer handler, so
      // it can't silence the internal or RFI reminders that run after it.
      try {
      // Load every Issued tender; the per-tender window check below decides
      // which ones are within daysB of their closing date.
      const { data: tenders, error: tendersErr } = await supabaseAdmin
        .from('tenders')
        .select('id, title, tender_number, location, closing_date, ths_rft_closing_date')
        .eq('status', 'Issued');
      if (tendersErr) throw new Error(`tenders query failed: ${tendersErr.message}`);

      const tpl = getTemplate('tender_reminder_external');

      for (const tender of (tenders || [])) {
        // Reminders count down to the THS RFT closing date — the date invitees
        // work to, and the one the invitation email shows — falling back to the
        // portal closing datetime when no RFT date is set. One reference date
        // drives the window, the countdown, the dedup key and {closing_date}, so
        // a reminder can never say "closes tomorrow" next to a different date.
        const referenceDate = tender.ths_rft_closing_date || tender.closing_date;
        if (!referenceDate) continue;
        // Extracted next to daysUntilNZ so the dedup key's date component
        // and the days-remaining calculation can never drift apart.
        const closingDay = String(referenceDate).split('T')[0];
        const days = daysUntilNZ(referenceDate);
        if (days === null) {
          details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days: null, action: 'skipped', reason: 'unparseable closing date' });
          continue;
        }
        if (days < 0 || days > daysB) {
          details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'outside window' });
          continue;
        }

        // Get invitees who haven't submitted
        const { data: invitations, error: invErr } = await supabaseAdmin
          .from('tender_invitations')
          .select('id, token, invitee_email, invitee_name, invitee_id')
          .eq('tender_id', tender.id)
          .in('status', ['Sent', 'Viewed']);

        if (invErr) {
          details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: `query failed: ${invErr.message}` });
          continue;
        }

        if (!invitations || invitations.length === 0) {
          details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'no invitees pending' });
        }

        const declined = await getDeclinedOrArchived(tender.id);

        for (const inv of (invitations || [])) {
          if (!inv.invitee_email) continue;
          // tender_invitations can't record a Decline (see getDeclinedOrArchived) -
          // match on invitee_id, falling back to email for older null-invitee_id rows.
          const isDeclined = (inv.invitee_id && declined.ids.has(inv.invitee_id))
            || declined.emails.has(inv.invitee_email.toLowerCase());
          if (isDeclined) {
            totalSkipped++;
            details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'declined', recipients: [inv.invitee_email] });
            continue;
          }

          const logKey = `tender_ext_${tender.id}_${closingDay}_${daysB}d`;
          const dedup = await alreadySent(logKey, tender.id, inv.invitee_email);
          if (dedup.skip) {
            totalSkipped++;
            details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: dedup.reason, recipients: [inv.invitee_email] });
            continue;
          }

          const portalUrl = `${APP_URL}/tender-submit/${inv.token}`;
          const vars: Record<string, string> = {
            invitee_name:    escapeHtml(inv.invitee_name || 'Tenderer'),
            tender_number:   escapeHtml(tender.tender_number || ''),
            title:           escapeHtml(tender.title || ''),
            location:        escapeHtml(tender.location || ''),
            closing_date:    formatDate(referenceDate),
            ths_rft_closing_date: tender.ths_rft_closing_date ? formatDate(tender.ths_rft_closing_date) : '',
            tender_closing_date:  tender.closing_date ? formatDate(tender.closing_date) : '',
            days_remaining:  String(days),
            days_label:      daysLabel(days),
            submission_link: portalUrl,
            sender_name:     escapeHtml(fromName),
            company_name:    escapeHtml(branding.company_name || 'ConstructIQ'),
          };

          const rawBody = tpl?.body_html || `<p>Dear <strong>{invitee_name}</strong>,</p><p>This is a reminder that tender <strong>{tender_number}: {title}</strong> closes <strong>{days_label}</strong> on {closing_date}.</p><p style="margin-top:24px;"><a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Submit Pricing Now</a></p><p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`;
          const subject = tpl?.subject ? replaceVars(tpl.subject, vars) : `Reminder: ${tender.tender_number} — ${tender.title} closes ${daysLabel(days)}`;

          try {
            await sendTrackedEmail(
              resend,
              supabaseAdmin,
              { from: fromEmail, to: inv.invitee_email, subject, html: buildWrapper(replaceVars(rawBody, vars), branding) },
              { kind: 'reminder_tender_external', tenderId: tender.id, inviteeId: inv.invitee_id },
            );
            const logResult = await logSent(logKey, tender.id, inv.invitee_email);
            totalSent++;
            details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'sent', reason: logResult.error ? 'sent but not logged' : undefined, recipients: [inv.invitee_email] });
          } catch (_e) {
            totalSkipped++;
            details.push({ type: 'tender_ext', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'send error', recipients: [inv.invitee_email] });
          }
        }
      }
      } catch (e: any) {
        console.error(`[sendReminders] tender_external block failed: ${e.message}`);
        details.push({ type: 'tender_ext', id: null, title: null, days: null, action: 'skipped', reason: `query failed: ${e.message}` });
      }
    } else {
      details.push({ type: 'tender_ext', id: null, title: null, days: null, action: 'skipped', reason: 'settings disabled' });
    }

    // ── TENDER INTERNAL REMINDER ─────────────────────────────────────────────
    const intSetting = getSetting('tender_internal');
    if (intSetting?.enabled) {
      const daysB = intSetting.days_before || 1;

      try {
      const { data: tenders, error: tendersErr } = await supabaseAdmin
        .from('tenders')
        .select('id, title, tender_number, closing_date, ths_rft_closing_date, tender_lead_email, created_by_email')
        .eq('status', 'Issued');
      if (tendersErr) throw new Error(`tenders query failed: ${tendersErr.message}`);

      const tpl = getTemplate('tender_reminder_internal');

      for (const tender of (tenders || [])) {
        // Same reference date as the external reminder above: RFT close first,
        // portal close as the fallback.
        const referenceDate = tender.ths_rft_closing_date || tender.closing_date;
        if (!referenceDate) continue;
        const closingDay = String(referenceDate).split('T')[0];
        const days = daysUntilNZ(referenceDate);
        if (days === null) {
          details.push({ type: 'tender_int', id: tender.id, title: tender.title, days: null, action: 'skipped', reason: 'unparseable closing date' });
          continue;
        }
        if (days < 0 || days > daysB) {
          details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'outside window' });
          continue;
        }

        // Count submissions + invitees
        const [subRes, invRes] = await Promise.all([
          supabaseAdmin.from('tender_submissions').select('*', { count: 'exact', head: true }).eq('tender_id', tender.id),
          supabaseAdmin.from('tender_invitees').select('*', { count: 'exact', head: true }).eq('tender_id', tender.id),
        ]);
        if (subRes.error || invRes.error) {
          const msg = subRes.error?.message || invRes.error?.message;
          details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: `query failed: ${msg}` });
          continue;
        }
        const subCount = subRes.count;
        const invCount = invRes.count;

        // Get all admins + tender lead
        const { data: adminUsers, error: usersErr } = await supabaseAdmin
          .from('users')
          .select('email, full_name')
          .in('role', ['admin', 'pricing'])
          .eq('disabled', false);
        if (usersErr) {
          details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: `query failed: ${usersErr.message}` });
          continue;
        }

        const recipients = new Set<string>();
        (adminUsers || []).forEach(u => u.email && recipients.add(u.email));
        if (tender.tender_lead_email) recipients.add(tender.tender_lead_email);
        if (tender.created_by_email) recipients.add(tender.created_by_email);

        const adminUrl = `${APP_URL}/tenders/${tender.id}`;
        const logKey = `tender_int_${tender.id}_${closingDay}_${daysB}d`;

        if (recipients.size === 0) {
          details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'no invitees pending' });
        }

        for (const email of recipients) {
          const dedup = await alreadySent(logKey, tender.id, email);
          if (dedup.skip) {
            totalSkipped++;
            details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: dedup.reason, recipients: [email] });
            continue;
          }

          const vars: Record<string, string> = {
            tender_number:    escapeHtml(tender.tender_number || ''),
            title:            escapeHtml(tender.title || ''),
            closing_date:     formatDate(referenceDate),
            ths_rft_closing_date: tender.ths_rft_closing_date ? formatDate(tender.ths_rft_closing_date) : '',
            tender_closing_date:  tender.closing_date ? formatDate(tender.closing_date) : '',
            days_remaining:   String(days),
            days_label:       daysLabel(days),
            submission_count: String(subCount || 0),
            invitee_count:    String(invCount || 0),
            admin_url:        adminUrl,
          };

          const rawBody = tpl?.body_html || `<p>Hi,</p><p>Tender <strong>{tender_number}: {title}</strong> closes <strong>{days_label}</strong> on {closing_date}.</p><p>{submission_count} of {invitee_count} invitees have submitted.</p><p style="margin-top:24px;"><a href="{admin_url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Tender</a></p>`;
          const subject = tpl?.subject ? replaceVars(tpl.subject, vars) : `Reminder: ${tender.tender_number} — ${tender.title} closes ${daysLabel(days)}`;

          try {
            await sendTrackedEmail(
              resend,
              supabaseAdmin,
              { from: fromEmail, to: email, subject, html: buildWrapper(replaceVars(rawBody, vars), branding) },
              { kind: 'reminder_tender_internal', tenderId: tender.id },
            );
            const logResult = await logSent(logKey, tender.id, email);
            totalSent++;
            details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'sent', reason: logResult.error ? 'sent but not logged' : undefined, recipients: [email] });
          } catch (_e) {
            totalSkipped++;
            details.push({ type: 'tender_int', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'send error', recipients: [email] });
          }
        }
      }
      } catch (e: any) {
        console.error(`[sendReminders] tender_internal block failed: ${e.message}`);
        details.push({ type: 'tender_int', id: null, title: null, days: null, action: 'skipped', reason: `query failed: ${e.message}` });
      }
    } else {
      details.push({ type: 'tender_int', id: null, title: null, days: null, action: 'skipped', reason: 'settings disabled' });
    }

    // ── RFI QUESTIONS DEADLINE REMINDER ──────────────────────────────────────
    const rfiSetting = getSetting('rfi_reminder');
    if (rfiSetting?.enabled) {
      const daysB = rfiSetting.days_before || 1;

      try {
      const { data: tenders, error: tendersErr } = await supabaseAdmin
        .from('tenders')
        .select('id, title, tender_number, questions_date')
        .eq('status', 'Issued')
        .not('questions_date', 'is', null);
      if (tendersErr) throw new Error(`tenders query failed: ${tendersErr.message}`);

      const tpl = getTemplate('rfi_reminder');

      for (const tender of (tenders || [])) {
        if (!tender.questions_date) continue;
        const questionsDay = tender.questions_date.split('T')[0];
        const days = daysUntilNZ(tender.questions_date);
        if (days === null) {
          details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days: null, action: 'skipped', reason: 'unparseable closing date' });
          continue;
        }
        if (days < 0 || days > daysB) {
          details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'outside window' });
          continue;
        }

        const { data: invitations, error: invErr } = await supabaseAdmin
          .from('tender_invitations')
          .select('id, token, invitee_email, invitee_name, invitee_id')
          .eq('tender_id', tender.id)
          .in('status', ['Sent', 'Viewed']);

        if (invErr) {
          details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: `query failed: ${invErr.message}` });
          continue;
        }

        const logKey = `rfi_rem_${tender.id}_${questionsDay}_${daysB}d`;

        if (!invitations || invitations.length === 0) {
          details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'no invitees pending' });
        }

        const declined = await getDeclinedOrArchived(tender.id);

        for (const inv of (invitations || [])) {
          if (!inv.invitee_email) continue;
          const isDeclined = (inv.invitee_id && declined.ids.has(inv.invitee_id))
            || declined.emails.has(inv.invitee_email.toLowerCase());
          if (isDeclined) {
            totalSkipped++;
            details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'declined', recipients: [inv.invitee_email] });
            continue;
          }

          const dedup = await alreadySent(logKey, tender.id, inv.invitee_email);
          if (dedup.skip) {
            totalSkipped++;
            details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: dedup.reason, recipients: [inv.invitee_email] });
            continue;
          }

          const portalUrl = `${APP_URL}/tender-submit/${inv.token}`;
          const vars: Record<string, string> = {
            invitee_name:   escapeHtml(inv.invitee_name || 'Tenderer'),
            tender_number:  escapeHtml(tender.tender_number || ''),
            title:          escapeHtml(tender.title || ''),
            questions_date: formatDate(tender.questions_date),
            days_remaining: String(days),
            days_label:     daysLabel(days),
            submission_link: portalUrl,
            sender_name:    escapeHtml(fromName),
            company_name:   escapeHtml(branding.company_name || 'ConstructIQ'),
          };

          const rawBody = tpl?.body_html || `<p>Dear <strong>{invitee_name}</strong>,</p><p>This is a reminder that the questions deadline for tender <strong>{tender_number}: {title}</strong> is <strong>{days_label}</strong> on {questions_date}.</p><p style="margin-top:24px;"><a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">Submit a Question</a></p><p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`;
          const subject = tpl?.subject ? replaceVars(tpl.subject, vars) : `Reminder: Questions close ${daysLabel(days)} — ${tender.tender_number}: ${tender.title}`;

          try {
            await sendTrackedEmail(
              resend,
              supabaseAdmin,
              { from: fromEmail, to: inv.invitee_email, subject, html: buildWrapper(replaceVars(rawBody, vars), branding) },
              { kind: 'reminder_questions_deadline', tenderId: tender.id, inviteeId: inv.invitee_id },
            );
            const logResult = await logSent(logKey, tender.id, inv.invitee_email);
            totalSent++;
            details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'sent', reason: logResult.error ? 'sent but not logged' : undefined, recipients: [inv.invitee_email] });
          } catch (_e) {
            totalSkipped++;
            details.push({ type: 'rfi_reminder', id: tender.id, title: tender.title, days, action: 'skipped', reason: 'send error', recipients: [inv.invitee_email] });
          }
        }
      }
      } catch (e: any) {
        console.error(`[sendReminders] rfi_reminder block failed: ${e.message}`);
        details.push({ type: 'rfi_reminder', id: null, title: null, days: null, action: 'skipped', reason: `query failed: ${e.message}` });
      }
    } else {
      details.push({ type: 'rfi_reminder', id: null, title: null, days: null, action: 'skipped', reason: 'settings disabled' });
    }

    console.log(`[sendReminders] DONE sent=${totalSent} skipped=${totalSkipped}`);
    await logRun(triggerType, { sent: totalSent, skipped: totalSkipped, details });
    return Response.json({ success: true, sent: totalSent, skipped: totalSkipped, details }, { headers: corsHeaders });

  } catch (e: any) {
    console.error('[sendReminders] ERROR:', e.message);
    await logRun(triggerType, { sent: 0, skipped: 0, error: e.message });
    return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
});
