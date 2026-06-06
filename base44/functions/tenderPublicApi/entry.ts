import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { action, token, submission } = payload;

    if (!token) {
      return Response.json({ error: 'Token required' }, { status: 400 });
    }

    // O(1) token lookup via TenderInvitation entity
    const invitations = await base44.asServiceRole.entities.TenderInvitation.filter({ token });
    const invitation = invitations[0];

    if (!invitation) {
      return Response.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const tender = await base44.asServiceRole.entities.Tender.get(invitation.tender_id);
    if (!tender) {
      return Response.json(
        { error: `Tender not found (id: ${invitation.tender_id})` },
        { status: 404 }
      );
    }

    if (action === 'get') {
      // Mark as Viewed if still Sent — track opened_date
      if (invitation.status === 'Sent') {
        await base44.asServiceRole.entities.TenderInvitation.update(invitation.id, {
          status: 'Viewed',
          opened_date: new Date().toISOString(),
        });
      }

      // Build invitee data from TenderInvitation (source of truth) + legacy fallback
      const legacyInvitee = (tender.invitees || []).find(inv => inv.token === token);
      return Response.json({
        tender: {
          id: tender.id,
          title: tender.title,
          description: tender.description,
          closing_date: tender.closing_date,
          trade_packages: tender.trade_packages || [],
          documents: tender.documents || [],
          location: tender.location,
          tender_number: tender.tender_number,
          status: tender.status,
        },
        invitee: {
          id: legacyInvitee?.id || invitation.id,
          full_name: invitation.invitee_name || legacyInvitee?.full_name || '',
          business_name: legacyInvitee?.business_name || '',
          email: invitation.invitee_email || legacyInvitee?.email || '',
          status: invitation.status,
          submission: legacyInvitee?.submission || null,
        }
      });
    }

    if (action === 'submit') {
      if (tender.status !== 'Issued') {
        return Response.json({
          error: tender.status === 'Closed'
            ? 'This tender has been closed and is no longer accepting submissions.'
            : 'This tender is no longer accepting submissions.',
        }, { status: 400 });
      }

      if (tender.closing_date) {
        // Treat closing_date as end of that day in NZT (UTC+12)
        const dateOnly = tender.closing_date.split('T')[0];
        const closingStr = `${dateOnly}T23:59:59+12:00`;
        const closingMs = new Date(closingStr).getTime();
        if (!isNaN(closingMs) && Date.now() > closingMs) {
          return Response.json({ error: 'The closing date for this tender has passed.' }, { status: 400 });
        }
      }

      if (!submission?.lump_sum_price) {
        return Response.json({ error: 'Lump sum price is required.' }, { status: 400 });
      }

      // Update TenderInvitation — source of truth
      const submittedAt = new Date().toISOString();
      await base44.asServiceRole.entities.TenderInvitation.update(invitation.id, {
        status: 'Submitted',
        submitted_date: submittedAt,
      });

      // Legacy bridge: also update Tender.invitees[] for scoring UI compatibility
      const invitees = tender.invitees || [];
      const tokenIndex = invitees.findIndex(inv => inv.token === token);
      if (tokenIndex !== -1) {
        const updatedInvitees = [...invitees];
        updatedInvitees[tokenIndex] = {
          ...updatedInvitees[tokenIndex],
          status: 'Submitted',
          submission: {
            ...submission,
            submitted_at: submittedAt,
          }
        };
        await base44.asServiceRole.entities.Tender.update(tender.id, { invitees: updatedInvitees });
      }

      // Use invitation data for emails (TenderInvitation is source of truth)
      const invitee = {
        full_name: invitation.invitee_name || '',
        email: invitation.invitee_email || '',
        business_name: invitees[tokenIndex]?.business_name || '',
      };

      // Fetch branding
      const brandings = await base44.asServiceRole.entities.EmailBranding.list();
      const branding = brandings[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';
      const fromName = branding.sender_name || branding.company_name || 'ConstructIQ';
      const senderEmail = branding.sender_email || 'noreply@totalhomesolutions.co.nz';
      const fromEmail = `${fromName} <${senderEmail}>`;
      const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

      // Confirmation email to invitee
      try {
        if (invitee.email) {
          const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f3f4f6;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
      <tr><td style="background:${brandColour};height:4px;"></td></tr>
      <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
        <p>Dear <strong>${invitee.full_name}</strong>,</p>
        <p>Thank you for submitting your pricing for <strong>${tender.title}</strong>.</p>
        <p>Your submission has been received. We will be in touch following the
           closing date${tender.closing_date ? ' of <strong>' + tender.closing_date + '</strong>' : ''}.</p>
        <p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>${branding.company_name || 'ConstructIQ'}</p>
      </td></tr>
      <tr><td style="background:${brandColour};height:2px;"></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

          await resend.emails.send({
            from: fromEmail,
            to: invitee.email,
            subject: `Tender Submission Received — ${tender.tender_number || ''}: ${tender.title}`,
            html: htmlBody,
          });
        }
      } catch (_e) { /* non-blocking */ }

      // Notify creator
      try {
        if (tender.created_by_email) {
          const price = submission.lump_sum_price
            ? `NZD ${Number(submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`
            : 'Not provided';

          const creatorHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f3f4f6;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
           style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
      <tr><td style="background:${brandColour};height:4px;"></td></tr>
      <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
        <p>A new submission has been received for <strong>${tender.title}</strong>.</p>
        <table style="width:100%;margin:16px 0;border-collapse:collapse;">
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Subcontractor</td>
              <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:600;">${invitee.full_name}${invitee.business_name ? ' (' + invitee.business_name + ')' : ''}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Submitted</td>
              <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;">${new Date().toLocaleDateString('en-NZ')}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#6b7280;">Price</td>
              <td style="padding:8px 0;font-size:14px;font-weight:600;">${price}</td></tr>
        </table>
        <p style="font-size:13px;color:#6b7280;">Log in to view and score this submission.</p>
      </td></tr>
      <tr><td style="background:${brandColour};height:2px;"></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

          await resend.emails.send({
            from: fromEmail,
            to: tender.created_by_email,
            subject: `New Submission — ${tender.title}`,
            html: creatorHtml,
          });
        }
      } catch (_e) { /* non-blocking */ }

      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});