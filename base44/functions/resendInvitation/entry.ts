import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

/**
 * resendInvitation
 *
 * Finds the existing TenderInvitation for an invitee, generates a new token,
 * updates the invitation record, and resends the email.
 *
 * Payload: { inviteeId }
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
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
    }

    const { inviteeId } = await req.json();
    if (!inviteeId) return Response.json({ error: 'inviteeId required' }, { status: 400 });

    // Load invitee
    const invitees = await sr.entities.TenderInvitee.filter({ id: inviteeId });
    const invitee = invitees[0];
    if (!invitee) return Response.json({ error: 'Invitee not found' }, { status: 404 });
    if (!invitee.email) return Response.json({ error: 'Invitee has no email address' }, { status: 400 });

    const blockedStatuses = ['Submitted', 'Archived'];
    if (blockedStatuses.includes(invitee.status)) {
      return Response.json({ error: `Cannot resend invitation to a ${invitee.status} invitee` }, { status: 400 });
    }

    // Load tender
    const tenders = await sr.entities.Tender.filter({ id: invitee.tender_id });
    const tender = tenders[0];
    if (!tender) return Response.json({ error: 'Tender not found' }, { status: 404 });

    // Find existing TenderInvitation
    const existingInvitations = await sr.entities.TenderInvitation.filter({
      tender_id: invitee.tender_id,
      invitee_id: inviteeId,
    });

    const sentDate = new Date().toISOString();
    const newToken = crypto.randomUUID();
    let invitationRecord;

    if (existingInvitations.length > 0) {
      // Update existing invitation with a fresh token
      invitationRecord = await sr.entities.TenderInvitation.update(existingInvitations[0].id, {
        token: newToken,
        status: 'Sent',
        sent_date: sentDate,
        opened_date: null,
        submitted_date: null,
      });
      // Return full record for the link
      invitationRecord = { ...existingInvitations[0], token: newToken };
      console.log(`[resendInvitation] TenderInvitation UPDATED id=${existingInvitations[0].id} newToken=${newToken.slice(0, 8)}...`);
    } else {
      // Create a new invitation record if none exists
      invitationRecord = await sr.entities.TenderInvitation.create({
        token: newToken,
        tender_id: invitee.tender_id,
        invitee_id: inviteeId,
        invitee_email: invitee.email,
        invitee_name: invitee.full_name || '',
        status: 'Sent',
        sent_date: sentDate,
      });
      console.log(`[resendInvitation] TenderInvitation CREATED id=${invitationRecord.id}`);
    }

    // Update invitee status back to Invited
    await sr.entities.TenderInvitee.update(inviteeId, { status: 'Invited' });

    // Load branding + templates
    const [templates, brandings] = await Promise.all([
      sr.entities.EmailTemplate.list(),
      sr.entities.EmailBranding.list(),
    ]);
    const branding = brandings[0] || {};
    const brandColour = branding.brand_colour || '#1a56db';
    const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';
    const senderEmail = branding.sender_email || 'noreply@totalhomesolutions.co.nz';
    const fromEmail = `${fromName} <${senderEmail}>`;
    const resend = new Resend(RESEND_API_KEY);
    const tpl = templates.find(t => t.template_key === 'tender_invitation');
    const defaultBody = `You have been invited to submit pricing for {title}.\n\nPlease click the link below to view the tender documents and submit your pricing:\n\n{submission_link}\n\nClosing Date: {closing_date}\n\nRegards,\n{sender_name}`;

    const appUrl = req.headers.get('origin') || 'https://app.constructiq.co.nz';
    const submissionLink = `${appUrl}/tender-submit/${invitationRecord.token}`;

    const vars = {
      tender_number: tender.tender_number || '',
      title: tender.title || '',
      invitee_name: invitee.full_name || '',
      company_name: branding.company_name || 'ConstructIQ',
      location: tender.location || '',
      closing_date: tender.closing_date || '',
      trade_packages: (tender.trade_packages || []).join(', '),
      description: tender.description || '',
      submission_link: submissionLink,
      sender_name: branding.sender_name || branding.company_name || 'ConstructIQ',
    };

    const replace = (str) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
    const rawBody = tpl?.body_html || tpl?.body_text || defaultBody;
    const subject = tpl?.subject ? replace(tpl.subject) : `Tender Invitation — ${vars.tender_number}: ${vars.title}`;
    const isHtml = rawBody.trim().startsWith('<') || !!tpl?.body_html;
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
        <p>Dear <strong>${invitee.full_name}</strong>,</p>
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

    await resend.emails.send({ from: fromEmail, to: invitee.email, subject, html: htmlBody, text: bodyText });
    console.log(`[resendInvitation] SENT to=${invitee.email} inviteeId=${inviteeId}`);

    return Response.json({ success: true, email: invitee.email });

  } catch (error) {
    console.error('[resendInvitation] FATAL:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});