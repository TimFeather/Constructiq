import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

/**
 * sendTenderInvitations
 *
 * CRITICAL FIX 1 & 2: TenderInvitation is created and VERIFIED before any email is sent.
 * If TenderInvitation creation or verification fails, the email is NOT sent and the error
 * is returned — no silent failures.
 *
 * Payload:
 *   tenderId    – Tender record ID
 *   tenderInfo  – { title, tender_number, location, closing_date, description,
 *                   trade_packages, client_name, architect_name, project_manager_name }
 *   invitees    – [{ id, email, full_name, token }]
 *   appUrl      – window.location.origin
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return Response.json({ error: 'Email service not configured — RESEND_API_KEY missing', sent: 0, failed: 0 });
    }

    const payload = await req.json();
    const { tenderInfo, invitees: inviteesToEmail, appUrl, tenderId } = payload;

    if (!inviteesToEmail?.length) {
      return Response.json({ error: 'No invitees provided', sent: 0, failed: 0 });
    }
    if (!tenderInfo?.title) {
      return Response.json({ error: 'tenderInfo is required', sent: 0, failed: 0 });
    }
    if (!tenderId) {
      return Response.json({ error: 'tenderId is required', sent: 0, failed: 0 });
    }

    console.log(`[sendTenderInvitations] START tenderId=${tenderId} invitees=${inviteesToEmail.length} user=${user.email}`);

    // Fetch branding + email templates
    const [templates, brandings] = await Promise.all([
      base44.asServiceRole.entities.EmailTemplate.list(),
      base44.asServiceRole.entities.EmailBranding.list(),
    ]);

    const branding = brandings[0] || {};
    const brandColour = branding.brand_colour || '#1a56db';
    const resend = new Resend(RESEND_API_KEY);
    const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';
    const senderEmail = branding.sender_email || 'noreply@totalhomesolutions.co.nz';
    const fromEmail = `${fromName} <${senderEmail}>`;

    const tpl = templates.find(t => t.template_key === 'tender_invitation');
    const defaultSubject = `Tender Invitation — ${tenderInfo.tender_number || ''}: ${tenderInfo.title}`;
    const defaultBody = `You have been invited to submit pricing for {title}.\n\nPlease click the link below to view the tender documents and submit your pricing:\n\n{submission_link}\n\nClosing Date: {closing_date}\n\nRegards,\n{sender_name}`;

    let sent = 0;
    let failed = 0;
    const errors = [];
    const sentDate = new Date().toISOString();

    for (const inv of inviteesToEmail) {
      const invLabel = `${inv.full_name || 'Unknown'} (${inv.email || 'no-email'})`;

      // ── Pre-flight validation ──────────────────────────────────────────────
      if (!inv.email) {
        const msg = `${inv.full_name || 'Unknown'}: no email address — skipped`;
        console.error(`[sendTenderInvitations] SKIP ${msg}`);
        errors.push(msg);
        failed++;
        continue;
      }
      if (!inv.token) {
        const msg = `${invLabel}: no invitation token — skipped`;
        console.error(`[sendTenderInvitations] SKIP ${msg}`);
        errors.push(msg);
        failed++;
        continue;
      }

      // ── CRITICAL FIX 1: Create TenderInvitation BEFORE sending email ──────
      let invitationRecord = null;
      try {
        // Check if one already exists for this token
        const existing = await base44.asServiceRole.entities.TenderInvitation.filter({ token: inv.token });

        if (existing.length > 0) {
          // Update the existing record
          await base44.asServiceRole.entities.TenderInvitation.update(existing[0].id, {
            invitee_email: inv.email,
            invitee_name:  inv.full_name || '',
            status:        'Sent',
            sent_date:     sentDate,
          });
          invitationRecord = { id: existing[0].id };
          console.log(`[sendTenderInvitations] TenderInvitation UPDATED id=${existing[0].id} token=${inv.token}`);
        } else {
          // Create a new record
          invitationRecord = await base44.asServiceRole.entities.TenderInvitation.create({
            token:         inv.token,
            tender_id:     tenderId,
            invitee_email: inv.email,
            invitee_name:  inv.full_name || '',
            status:        'Sent',
            sent_date:     sentDate,
          });
          console.log(`[sendTenderInvitations] TenderInvitation CREATED id=${invitationRecord?.id} token=${inv.token} tender_id=${tenderId}`);
        }
      } catch (dbErr) {
        // CRITICAL FIX 2: TenderInvitation failure is BLOCKING — do not send email
        const msg = `${invLabel}: TenderInvitation DB error — ${dbErr?.message || 'unknown'}`;
        console.error(`[sendTenderInvitations] ABORT ${msg}`);
        errors.push(msg);
        failed++;
        continue;
      }

      // ── CRITICAL FIX 1: Verify TenderInvitation exists before sending ─────
      if (!invitationRecord?.id) {
        const msg = `${invLabel}: TenderInvitation has no id after create/update — email not sent`;
        console.error(`[sendTenderInvitations] ABORT ${msg}`);
        errors.push(msg);
        failed++;
        continue;
      }

      // ── Build and send email ──────────────────────────────────────────────
      const submissionLink = `${appUrl}/tender-submit/${inv.token}`;

      const vars = {
        tender_number:        tenderInfo.tender_number || '',
        title:                tenderInfo.title || '',
        invitee_name:         inv.full_name || '',
        company_name:         branding.company_name || 'ConstructIQ',
        location:             tenderInfo.location || '',
        closing_date:         tenderInfo.closing_date || '',
        trade_packages:       (tenderInfo.trade_packages || []).join(', '),
        description:          tenderInfo.description || '',
        client_name:          tenderInfo.client_name || '',
        architect_name:       tenderInfo.architect_name || '',
        project_manager_name: tenderInfo.project_manager_name || '',
        submission_link:      submissionLink,
        sender_name:          branding.sender_name || branding.company_name || 'ConstructIQ',
      };

      const replace = (str) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

      const subject     = tpl?.subject   ? replace(tpl.subject)   : replace(defaultSubject);
      const rawBody     = tpl?.body_html || tpl?.body_text        || defaultBody;
      const bodyText    = replace(rawBody);
      const isHtml      = rawBody.trim().startsWith('<') || !!tpl?.body_html;
      const bodyContent = isHtml ? replace(rawBody) : replace(rawBody).replace(/\n/g, '<br>');

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
        await resend.emails.send({
          from: fromEmail,
          to:   inv.email,
          subject,
          html: htmlBody,
          text: bodyText,
        });
        sent++;
        console.log(`[sendTenderInvitations] EMAIL SENT to=${inv.email} invitation_id=${invitationRecord.id}`);
      } catch (emailErr) {
        failed++;
        const msg = `${invLabel}: email send failed — ${emailErr?.message || 'unknown'}`;
        errors.push(msg);
        console.error(`[sendTenderInvitations] EMAIL FAILED ${msg}`);
      }
    }

    console.log(`[sendTenderInvitations] COMPLETE sent=${sent} failed=${failed} errors=${errors.length}`);
    return Response.json({ sent, failed, errors });

  } catch (error) {
    console.error('[sendTenderInvitations] FATAL:', error.message);
    return Response.json({ error: error.message, sent: 0, failed: 0 }, { status: 500 });
  }
});