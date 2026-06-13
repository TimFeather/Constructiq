/**
 * notifySubmissionReceived
 *
 * Triggered by entity automation on TenderSubmission create.
 * Notifies the Tender Lead and optionally all admin users,
 * based on TenderSettings toggles.
 *
 * Payload: { event, data } — standard entity automation payload.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[notifySubmissionReceived] ${msg}`); log.push(msg); };

  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const body = await req.json();
    trace(`Payload keys: ${Object.keys(body).join(', ')}`);

    // Support both direct invocation and entity automation payload
    const submission = body.data || body.submission;
    if (!submission || !submission.tender_id) {
      return Response.json({ error: 'No submission data in payload', log }, { status: 400 });
    }

    trace(`submission.id=${submission.id} tender_id=${submission.tender_id}`);

    // Fetch tender, settings, branding in parallel
    const [tender, settingsList, brandings, adminUsers] = await Promise.all([
      sr.entities.Tender.get(submission.tender_id),
      sr.entities.TenderSettings.list(),
      sr.entities.EmailBranding.list(),
      sr.entities.User.filter({ role: 'admin' }),
    ]);

    if (!tender) {
      trace('Tender not found — aborting');
      return Response.json({ error: 'Tender not found', log }, { status: 404 });
    }

    const settings = settingsList[0] || {};
    const branding = brandings[0] || {};
    const notifyLead   = settings.notify_lead_on_submission   !== false; // default true
    const notifyAdmins = settings.notify_admins_on_submission === true;  // default false

    const fromName  = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;
    const resend    = new Resend(Deno.env.get('RESEND_API_KEY'));

    const submittedAt = submission.submitted_at
      ? new Date(submission.submitted_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short' })
      : new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'short' });

    const appUrl = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
    const tenderUrl = `${appUrl}/tenders/${tender.id}`;

    const subject = `Tender Submission Received - ${tender.tender_number || tender.title}`;

    const buildHtml = (recipientName) => `
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
            <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Hi ${recipientName || 'there'},</p>
            <h2 style="margin:0 0 24px;font-size:20px;color:#111827;">New Submission Received</h2>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:24px;">
              <tr><td style="padding:16px 20px;">
                <table width="100%" cellpadding="4" cellspacing="0">
                  <tr>
                    <td style="font-size:12px;color:#6b7280;width:140px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Tender</td>
                    <td style="font-size:14px;color:#111827;font-weight:600;">${tender.tender_number || ''} — ${tender.title}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Trade</td>
                    <td style="font-size:14px;color:#111827;">${submission.trade || '—'}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Contractor</td>
                    <td style="font-size:14px;color:#111827;">${submission.invitee_name || submission.full_name || '—'}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Business</td>
                    <td style="font-size:14px;color:#111827;">${submission.business_name || '—'}</td>
                  </tr>
                  <tr>
                    <td style="font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Received</td>
                    <td style="font-size:14px;color:#111827;">${submittedAt}</td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <a href="${tenderUrl}" style="display:inline-block;background:${branding.brand_colour || '#1a56db'};color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">View Tender →</a>

            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">${branding.footer_text || ''}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const recipients = [];

    // Tender Lead
    if (notifyLead && tender.tender_lead_email) {
      recipients.push({ email: tender.tender_lead_email, name: tender.tender_lead_name || '' });
      trace(`Notifying Tender Lead: ${tender.tender_lead_email}`);
    }

    // Admin users (deduplicated against Lead)
    if (notifyAdmins) {
      for (const admin of adminUsers) {
        if (admin.email && admin.email !== tender.tender_lead_email) {
          recipients.push({ email: admin.email, name: admin.full_name || '' });
          trace(`Notifying admin: ${admin.email}`);
        }
      }
    }

    if (recipients.length === 0) {
      trace('No recipients — nothing to send');
      return Response.json({ success: true, sent: 0, log });
    }

    let sent = 0;
    for (const recipient of recipients) {
      const result = await resend.emails.send({
        from: fromEmail,
        to: [{ email: recipient.email, name: recipient.name }],
        subject,
        html: buildHtml(recipient.name),
      });
      if (result?.data?.id) {
        sent++;
        trace(`Sent to ${recipient.email} id=${result.data.id}`);
      } else {
        trace(`FAILED to ${recipient.email}: ${JSON.stringify(result)}`);
      }
    }

    return Response.json({ success: true, sent, total: recipients.length, log });

  } catch (error) {
    console.error(`[notifySubmissionReceived] EXCEPTION: ${error.message}`, error.stack);
    return Response.json({ error: error.message, stack: error.stack, log }, { status: 500 });
  }
});