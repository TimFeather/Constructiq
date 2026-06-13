/**
 * send24hReminders
 *
 * Scheduled job — runs every hour.
 * For each Issued tender closing within the next 24 hours:
 *   - Find invitees with status Invited or Viewed who have not submitted
 *   - Send reminder if reminder_24h_sent_at is not set
 *   - Mark reminder_24h_sent_at to prevent duplicates
 *
 * Also sends a closing-alert summary to the Tender Lead.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[send24hReminders] ${msg}`); log.push(msg); };

  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    // Check settings
    const settingsList = await sr.entities.TenderSettings.list();
    const settings = settingsList[0] || {};
    if (settings.send_24h_reminder === false) {
      trace('24h reminders disabled in settings — exiting');
      return Response.json({ success: true, skipped: true, reason: 'disabled', log });
    }

    const brandings = await sr.entities.EmailBranding.list();
    const branding  = brandings[0] || {};
    const fromName  = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;
    const resend    = new Resend(Deno.env.get('RESEND_API_KEY'));
    const appUrl    = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';

    const now        = new Date();
    const in24h      = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Fetch all Issued tenders
    const tenders = await sr.entities.Tender.filter({ status: 'Issued' });
    trace(`Found ${tenders.length} Issued tenders`);

    let totalRemindersSent = 0;
    let totalLeadAlerts    = 0;

    for (const tender of tenders) {
      if (!tender.closing_date) continue;

      const closingDate = new Date(tender.closing_date);
      // Only tenders closing within the next 24h (and not already closed)
      if (closingDate <= now || closingDate > in24h) continue;

      trace(`Processing tender ${tender.tender_number} closing at ${tender.closing_date}`);

      const closingStr = closingDate.toLocaleString('en-NZ', {
        timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short'
      });

      // Fetch invitations and submissions for this tender
      const [invitations, invitees, submissions] = await Promise.all([
        sr.entities.TenderInvitation.filter({ tender_id: tender.id }),
        sr.entities.TenderInvitee.filter({ tender_id: tender.id }),
        sr.entities.TenderSubmission.filter({ tender_id: tender.id }),
      ]);

      const submittedInviteeIds = new Set(submissions.map(s => s.invitee_id).filter(Boolean));

      // Build stats for Lead alert
      const invited   = invitees.length;
      const viewed    = invitees.filter(i => i.status === 'Viewed').length;
      const submitted = invitees.filter(i => i.status === 'Submitted' || submittedInviteeIds.has(i.id)).length;
      const outstanding = invited - submitted;

      // Outstanding trades
      const outstandingTrades = [...new Set(
        invitees
          .filter(i => i.status !== 'Submitted' && !submittedInviteeIds.has(i.id) && i.status !== 'Archived' && i.status !== 'Declined')
          .map(i => i.trade)
          .filter(Boolean)
      )];

      // ── Send 24h reminders to individual invitees ──────────────────────
      for (const inv of invitations) {
        // Skip if already reminded
        if (inv.reminder_24h_sent_at) continue;
        // Skip if submitted
        if (inv.status === 'Submitted') continue;
        // Only Sent or Viewed
        if (!['Sent', 'Viewed'].includes(inv.status)) continue;
        // Verify no TenderSubmission exists
        const invitee = invitees.find(i => i.id === inv.invitee_id);
        if (!invitee) continue;
        if (submittedInviteeIds.has(inv.invitee_id)) continue;
        if (!['Invited', 'Viewed'].includes(invitee.status)) continue;
        if (!inv.invitee_email) continue;

        const submissionUrl = `${appUrl}/tender-submit/${inv.token}`;

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:${branding.brand_colour || '#1a56db'};padding:24px 32px;">
            ${branding.logo_url ? `<img src="${branding.logo_url}" height="40" alt="${branding.company_name || 'ConstructIQ'}" style="display:block;" />` : `<span style="color:#fff;font-size:20px;font-weight:700;">${branding.company_name || 'ConstructIQ'}</span>`}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Hi ${inv.invitee_name || 'there'},</p>
            <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Tender Closing Soon</h2>
            <p style="margin:0 0 24px;font-size:14px;color:#374151;">This is a reminder that the following tender is closing in less than 24 hours. Please submit your pricing before the closing time.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef9c3;border-radius:6px;border:1px solid #fde047;margin-bottom:24px;">
              <tr><td style="padding:16px 20px;">
                <table width="100%" cellpadding="4" cellspacing="0">
                  <tr>
                    <td style="font-size:12px;color:#92400e;width:140px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Tender</td>
                    <td style="font-size:14px;color:#78350f;font-weight:600;">${tender.tender_number || ''} — ${tender.title}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Trade</td>
                    <td style="font-size:14px;color:#78350f;">${invitee.trade || '—'}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Closing</td>
                    <td style="font-size:14px;color:#78350f;font-weight:700;">${closingStr}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <a href="${submissionUrl}" style="display:inline-block;background:${branding.brand_colour || '#1a56db'};color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Submit My Pricing →</a>

            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">${branding.footer_text || ''}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        const result = await resend.emails.send({
          from: fromEmail,
          to: [{ email: inv.invitee_email, name: inv.invitee_name || '' }],
          subject: `Reminder: Tender Closing Soon - ${tender.tender_number || tender.title}`,
          html,
        });

        if (result?.data?.id) {
          // Mark reminder sent
          await sr.entities.TenderInvitation.update(inv.id, {
            reminder_24h_sent_at: new Date().toISOString(),
          });
          totalRemindersSent++;
          trace(`Reminder sent to ${inv.invitee_email} inv.id=${inv.id}`);
        } else {
          trace(`Reminder FAILED to ${inv.invitee_email}: ${JSON.stringify(result)}`);
        }
      }

      // ── Send closing alert to Tender Lead ──────────────────────────────
      if (!tender.tender_lead_email) {
        trace(`No Tender Lead email for tender ${tender.tender_number} — skipping lead alert`);
        continue;
      }

      const tradeListHtml = outstandingTrades.length > 0
        ? outstandingTrades.map(t => `<li style="padding:2px 0;font-size:14px;color:#374151;">• ${t}</li>`).join('')
        : '<li style="font-size:14px;color:#6b7280;">None — all trades submitted</li>';

      const leadHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:${branding.brand_colour || '#1a56db'};padding:24px 32px;">
            ${branding.logo_url ? `<img src="${branding.logo_url}" height="40" alt="${branding.company_name || 'ConstructIQ'}" style="display:block;" />` : `<span style="color:#fff;font-size:20px;font-weight:700;">${branding.company_name || 'ConstructIQ'}</span>`}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Hi ${tender.tender_lead_name || 'there'},</p>
            <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Tender Closing in 24 Hours</h2>
            <p style="margin:0 0 24px;font-size:14px;color:#374151;">
              <strong>${tender.tender_number} — ${tender.title}</strong> closes at <strong>${closingStr}</strong>.
              Here is a summary of current submission activity.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:24px;">
              <tr><td style="padding:16px 20px;">
                <table width="100%" cellpadding="6" cellspacing="0">
                  <tr>
                    <td style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Total Invitees</td>
                    <td style="font-size:18px;font-weight:700;color:#111827;text-align:right;">${invited}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Viewed</td>
                    <td style="font-size:18px;font-weight:700;color:#2563eb;text-align:right;">${viewed}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Submitted</td>
                    <td style="font-size:18px;font-weight:700;color:#16a34a;text-align:right;">${submitted}</td>
                  </tr>
                  <tr style="background:#fef2f2;border-radius:4px;">
                    <td style="font-size:12px;color:#b91c1c;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Outstanding</td>
                    <td style="font-size:18px;font-weight:700;color:#dc2626;text-align:right;">${outstanding}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            ${outstandingTrades.length > 0 ? `
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Outstanding Trades:</p>
            <ul style="margin:0 0 24px;padding:0;list-style:none;">${tradeListHtml}</ul>
            ` : ''}

            <a href="${appUrl}/tenders/${tender.id}" style="display:inline-block;background:${branding.brand_colour || '#1a56db'};color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">View Tender →</a>

            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">${branding.footer_text || ''}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      const leadResult = await resend.emails.send({
        from: fromEmail,
        to: [{ email: tender.tender_lead_email, name: tender.tender_lead_name || '' }],
        subject: `Tender Closing Alert - ${tender.tender_number || tender.title}`,
        html: leadHtml,
      });

      if (leadResult?.data?.id) {
        totalLeadAlerts++;
        trace(`Lead alert sent to ${tender.tender_lead_email} for tender ${tender.tender_number}`);
      } else {
        trace(`Lead alert FAILED for ${tender.tender_number}: ${JSON.stringify(leadResult)}`);
      }
    }

    trace(`COMPLETE — reminders sent: ${totalRemindersSent}, lead alerts: ${totalLeadAlerts}`);
    return Response.json({ success: true, remindersSent: totalRemindersSent, leadAlerts: totalLeadAlerts, log });

  } catch (error) {
    console.error(`[send24hReminders] EXCEPTION: ${error.message}`, error.stack);
    return Response.json({ error: error.message, stack: error.stack, log }, { status: 500 });
  }
});