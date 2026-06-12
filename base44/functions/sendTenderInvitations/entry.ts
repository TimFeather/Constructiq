import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

/**
 * sendTenderInvitations
 *
 * Called when issuing a tender.
 * For each TenderInvitee with an email:
 *   1. Generate a unique token
 *   2. Create a TenderInvitation record (source of truth for the link)
 *   3. Update TenderInvitee.status = 'Invited'
 *   4. Send the invitation email
 *
 * Payload:
 *   tenderId   – Tender record ID
 *   tenderInfo – { title, tender_number, location, closing_date, description,
 *                  trade_packages, client_name, architect_name, project_manager_name }
 *   appUrl     – window.location.origin
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!['admin', 'pricing'].includes(user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY not configured', sent: 0, failed: 0 });
    }

    const { tenderId, tenderInfo, appUrl } = await req.json();
    if (!tenderId)        return Response.json({ error: 'tenderId required', sent: 0, failed: 0 });
    if (!tenderInfo?.title) return Response.json({ error: 'tenderInfo required', sent: 0, failed: 0 });

    console.log(`[sendTenderInvitations] START tenderId=${tenderId} user=${user.email}`);

    // Load all Draft/Pending invitees for this tender
    const allInvitees = await sr.entities.TenderInvitee.filter({ tender_id: tenderId });
    const toInvite = allInvitees.filter(i =>
      i.email && (i.status === 'Draft' || !i.status)
    );

    if (toInvite.length === 0) {
      return Response.json({ sent: 0, failed: 0, errors: [], message: 'No uninvited invitees with email addresses' });
    }

    // Load branding + templates
    const [templates, brandings] = await Promise.all([
      sr.entities.EmailTemplate.list(),
      sr.entities.EmailBranding.list(),
    ]);
    const branding     = brandings[0] || {};
    const brandColour  = branding.brand_colour || '#1a56db';
    const fromName     = branding.sender_name || branding.company_name || 'ConstructIQ';
    const senderEmail  = branding.sender_email || 'noreply@totalhomesolutions.co.nz';
    const fromEmail    = `${fromName} <${senderEmail}>`;
    const resend       = new Resend(RESEND_API_KEY);
    const tpl          = templates.find(t => t.template_key === 'tender_invitation');
    const defaultBody  = `You have been invited to submit pricing for {title}.\n\nPlease click the link below to view the tender documents and submit your pricing:\n\n{submission_link}\n\nClosing Date: {closing_date}\n\nRegards,\n{sender_name}`;
    const sentDate     = new Date().toISOString();

    let sent = 0, failed = 0;
    const errors = [];

    for (const inv of toInvite) {
      const label = `${inv.full_name || 'Unknown'} <${inv.email}>`;

      // INTEGRITY GUARD: invitee_id is mandatory — reject if missing
      if (!inv.id) {
        const msg = `${label}: missing invitee_id — skipped (integrity violation)`;
        console.error(`[sendTenderInvitations] REJECT ${msg}`);
        errors.push(msg);
        failed++;
        continue;
      }

      // Check for existing invitation for this invitee on this tender
      let invitationRecord = null;
      try {
        const existing = await sr.entities.TenderInvitation.filter({
          tender_id: tenderId,
          invitee_id: inv.id,
        });

        if (existing.length > 0) {
          // Reuse existing token — update status + sent_date
          await sr.entities.TenderInvitation.update(existing[0].id, {
            status:    'Sent',
            sent_date: sentDate,
            invitee_email: inv.email,
            invitee_name:  inv.full_name || '',
          });
          invitationRecord = existing[0];
          console.log(`[sendTenderInvitations] TenderInvitation REUSED id=${existing[0].id}`);
        } else {
          const token = crypto.randomUUID();
          invitationRecord = await sr.entities.TenderInvitation.create({
            token,
            tender_id:     tenderId,
            invitee_id:    inv.id,
            invitee_email: inv.email,
            invitee_name:  inv.full_name || '',
            status:        'Sent',
            sent_date:     sentDate,
          });
          console.log(`[sendTenderInvitations] TenderInvitation CREATED id=${invitationRecord.id}`);
        }
      } catch (dbErr) {
        const msg = `${label}: TenderInvitation DB error — ${dbErr.message}`;
        console.error(`[sendTenderInvitations] ABORT ${msg}`);
        errors.push(msg);
        failed++;
        continue;
      }

      if (!invitationRecord?.token) {
        const msg = `${label}: invitation has no token — skipped`;
        errors.push(msg);
        failed++;
        continue;
      }

      // Build submission link
      const submissionLink = `${appUrl}/tender-submit/${invitationRecord.token}`;

      const vars = {
        tender_number:        tenderInfo.tender_number || '',
        title:                tenderInfo.title || '',
        invitee_name:         inv.full_name || '',
        company_name:         branding.company_name || 'ConstructIQ',
        location:             tenderInfo.location || '',
        closing_date:         tenderInfo.closing_date || '',
        trade_packages:       (tenderInfo.trade_packages || []).join(', '),
        description:          tenderInfo.description || '',
        submission_link:      submissionLink,
        sender_name:          branding.sender_name || branding.company_name || 'ConstructIQ',
      };

      const replace  = (str) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
      const rawBody  = tpl?.body_html || tpl?.body_text || defaultBody;
      const subject  = tpl?.subject ? replace(tpl.subject) : `Tender Invitation — ${vars.tender_number}: ${vars.title}`;
      const isHtml   = rawBody.trim().startsWith('<') || !!tpl?.body_html;
      const bodyContent = isHtml ? replace(rawBody) : replace(rawBody).replace(/\n/g, '<br>');
      const bodyText = replace(rawBody);

      const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f3f4f6;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
      <tr><td style="background:${brandColour};padding:24px 40px;">
        ${branding.logo_url
          ? `<img src="${branding.logo_url}" alt="${branding.company_name || ''}" style="height:40px;display:block;">`
          : `<span style="color:#fff;font-size:20px;font-weight:700;">${branding.company_name || 'ConstructIQ'}</span>`}
      </td></tr>
      <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
        <p>Dear <strong>${inv.full_name}</strong>,</p>
        ${bodyContent}
        <div style="margin:28px 0;">
          <a href="${submissionLink}"
             style="display:inline-block;padding:14px 32px;background:${brandColour};color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;">
            View Tender &amp; Submit Pricing →
          </a>
        </div>
        <p style="font-size:13px;color:#6b7280;">
          Or copy this link: <a href="${submissionLink}" style="color:${brandColour};">${submissionLink}</a>
        </p>
      </td></tr>
      ${branding.footer_text
        ? `<tr><td style="padding:16px 40px;background:#f9fafb;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">${branding.footer_text}</td></tr>`
        : ''}
      <tr><td style="background:${brandColour};height:3px;"></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

      try {
        await resend.emails.send({ from: fromEmail, to: inv.email, subject, html: htmlBody, text: bodyText });
        sent++;
        console.log(`[sendTenderInvitations] SENT to=${inv.email}`);
      } catch (emailErr) {
        failed++;
        const msg = `${label}: email send failed — ${emailErr.message}`;
        errors.push(msg);
        console.error(`[sendTenderInvitations] ${msg}`);
        continue;
      }

      // Update TenderInvitee status to Invited
      try {
        await sr.entities.TenderInvitee.update(inv.id, { status: 'Invited' });
      } catch (e) {
        console.warn(`[sendTenderInvitations] TenderInvitee status update failed (non-fatal): ${e.message}`);
      }
    }

    console.log(`[sendTenderInvitations] COMPLETE sent=${sent} failed=${failed}`);
    return Response.json({ sent, failed, errors });

  } catch (error) {
    console.error('[sendTenderInvitations] FATAL:', error.message);
    return Response.json({ error: error.message, sent: 0, failed: 0 }, { status: 500 });
  }
});