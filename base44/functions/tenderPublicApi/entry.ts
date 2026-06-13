import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { Resend } from 'npm:resend@4.0.0';

/**
 * tenderPublicApi — clean architecture version
 *
 * Token lookup:  TenderInvitation only (no legacy fallback)
 * Submission:    Creates TenderSubmission record
 * Status:        Updates TenderInvitation + TenderInvitee
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;
    const payload = await req.json();
    const { action, token, submission } = payload;

    console.log(`[tenderPublicApi] action=${action} token=${token?.slice(0, 8)}...`);

    if (!token) return Response.json({ error: 'Token required' }, { status: 400 });

    // ── Token lookup via TenderInvitation (single source of truth) ────────────
    const invitations = await sr.entities.TenderInvitation.filter({ token });
    const invitation  = invitations[0];

    if (!invitation) {
      return Response.json({ error: 'Invalid or expired link — invitation not found' }, { status: 404 });
    }

    const tenders = await sr.entities.Tender.filter({ id: invitation.tender_id }, '-created_date', 1);
    const tender  = tenders[0];

    if (!tender) {
      return Response.json(
        { error: `Tender not found. Please ask the sender to resend your invitation.` },
        { status: 404 }
      );
    }

    console.log(`[tenderPublicApi] invitation id=${invitation.id} tender id=${tender.id} status=${tender.status}`);

    // ── UPLOAD ────────────────────────────────────────────────────────────────
    if (action === 'upload') {
      try {
        const { fileName, fileData, fileType } = payload;

        if (!fileName || !fileData) {
          return Response.json({ error: 'fileName and fileData required' }, { status: 400 });
        }

        console.log(`[tenderPublicApi] UPLOAD START fileName=${fileName} fileType=${fileType} base64Length=${fileData?.length}`);

        const binary = Uint8Array.from(atob(fileData), c => c.charCodeAt(0));
        const file   = new File([binary], fileName, { type: fileType || 'application/octet-stream' });

        console.log(`[tenderPublicApi] File constructed name=${file.name} type=${file.type} size=${file.size}`);

        const { file_url } = await sr.integrations.Core.UploadFile({ file });

        console.log(`[tenderPublicApi] UPLOAD SUCCESS file_url=${file_url}`);

        return Response.json({ file_url });

      } catch (uploadError) {
        console.error(`[tenderPublicApi] UPLOAD ERROR: ${uploadError?.message}`, uploadError);
        return Response.json({ error: uploadError?.message || 'Upload failed' }, { status: 500 });
      }
    }

    // ── GET ───────────────────────────────────────────────────────────────────
    if (action === 'get') {
      // Mark as Viewed if still Sent
      if (invitation.status === 'Sent') {
        await sr.entities.TenderInvitation.update(invitation.id, {
          status:      'Viewed',
          opened_date: new Date().toISOString(),
        });
        // Update TenderInvitee status too
        if (invitation.invitee_id) {
          await sr.entities.TenderInvitee.update(invitation.invitee_id, { status: 'Viewed' })
            .catch(e => console.warn(`[tenderPublicApi] TenderInvitee Viewed update failed: ${e.message}`));
        }
      }

      // Load existing submission if any
      let existingSubmission = null;
      try {
        const subs = await sr.entities.TenderSubmission.filter({ invitation_id: invitation.id });
        if (subs.length > 0) existingSubmission = subs[0];
      } catch (e) {
        console.warn(`[tenderPublicApi] TenderSubmission lookup failed: ${e.message}`);
      }

      return Response.json({
        tender: {
          id:             tender.id,
          title:          tender.title,
          description:    tender.description,
          closing_date:   tender.closing_date,
          trade_packages: tender.trade_packages || [],
          documents:      tender.documents      || [],
          location:       tender.location,
          tender_number:  tender.tender_number,
          status:         tender.status,
        },
        invitee: {
          full_name:     invitation.invitee_name  || '',
          email:         invitation.invitee_email || '',
          business_name: '',
          status:        invitation.status,
          submission:    existingSubmission,
        },
      });
    }

    // ── SUBMIT ────────────────────────────────────────────────────────────────
    if (action === 'submit') {
      if (tender.status !== 'Issued') {
        return Response.json({
          error: tender.status === 'Closed'
            ? 'This tender has been closed and is no longer accepting submissions.'
            : 'This tender is no longer accepting submissions.',
        }, { status: 400 });
      }

      if (tender.closing_date) {
        const closingMs = new Date(`${tender.closing_date.split('T')[0]}T23:59:59+12:00`).getTime();
        if (!isNaN(closingMs) && Date.now() > closingMs) {
          return Response.json({ error: 'The closing date for this tender has passed.' }, { status: 400 });
        }
      }

      if (!submission?.lump_sum_price) {
        return Response.json({ error: 'Lump sum price is required.' }, { status: 400 });
      }

      const submittedAt = new Date().toISOString();

      // Upsert TenderSubmission
      let submissionRecord;
      try {
        const existing = await sr.entities.TenderSubmission.filter({ invitation_id: invitation.id });
        if (existing.length > 0) {
          submissionRecord = await sr.entities.TenderSubmission.update(existing[0].id, {
            lump_sum_price:     submission.lump_sum_price,
            notes:              submission.notes              || '',
            uploaded_file_url:  submission.uploaded_file_url  || '',
            uploaded_file_name: submission.uploaded_file_name || '',
            submitted_at:       submittedAt,
          });
          console.log(`[tenderPublicApi] TenderSubmission UPDATED id=${existing[0].id}`);
        } else {
          submissionRecord = await sr.entities.TenderSubmission.create({
            tender_id:          tender.id,
            invitee_id:         invitation.invitee_id  || '',
            invitation_id:      invitation.id,
            invitee_name:       invitation.invitee_name  || '',
            invitee_email:      invitation.invitee_email || '',
            business_name:      '',
            lump_sum_price:     submission.lump_sum_price,
            notes:              submission.notes              || '',
            uploaded_file_url:  submission.uploaded_file_url  || '',
            uploaded_file_name: submission.uploaded_file_name || '',
            submitted_at:       submittedAt,
          });
          console.log(`[tenderPublicApi] TenderSubmission CREATED id=${submissionRecord.id}`);
        }
      } catch (e) {
        console.error(`[tenderPublicApi] TenderSubmission upsert failed: ${e.message}`);
        return Response.json({ error: `Submission save failed: ${e.message}` }, { status: 500 });
      }

      // Update TenderInvitation status
      await sr.entities.TenderInvitation.update(invitation.id, {
        status:         'Submitted',
        submitted_date: submittedAt,
      });

      // Update TenderInvitee status
      if (invitation.invitee_id) {
        await sr.entities.TenderInvitee.update(invitation.invitee_id, { status: 'Submitted' })
          .catch(e => console.warn(`[tenderPublicApi] TenderInvitee Submitted update failed: ${e.message}`));
      }

      // Fetch branding for emails
      const brandings   = await sr.entities.EmailBranding.list();
      const branding    = brandings[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';
      const fromName    = branding.sender_name || branding.company_name || 'ConstructIQ';
      const senderEmail = branding.sender_email || 'noreply@totalhomesolutions.co.nz';
      const fromEmail   = `${fromName} <${senderEmail}>`;
      const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));

      // Confirmation to invitee
      if (invitation.invitee_email) {
        try {
          await resend.emails.send({
            from:    fromEmail,
            to:      invitation.invitee_email,
            subject: `Tender Submission Received — ${tender.tender_number || ''}: ${tender.title}`,
            html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px 16px;">
<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <tr><td style="background:${brandColour};height:4px;"></td></tr>
  <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
    <p>Dear <strong>${invitation.invitee_name}</strong>,</p>
    <p>Thank you for submitting your pricing for <strong>${tender.title}</strong>.</p>
    <p>Your submission has been received. We will be in touch following the closing date${tender.closing_date ? ' of <strong>' + tender.closing_date + '</strong>' : ''}.</p>
    <p style="color:#6b7280;font-size:13px;">Regards,<br>${branding.company_name || 'ConstructIQ'}</p>
  </td></tr>
  <tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></body></html>`,
          });
        } catch (_e) { /* non-blocking */ }
      }

      // Notify tender creator
      if (tender.created_by_email) {
        try {
          const price = `NZD ${Number(submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`;
          await resend.emails.send({
            from:    fromEmail,
            to:      tender.created_by_email,
            subject: `New Submission — ${tender.title}`,
            html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px 16px;">
<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <tr><td style="background:${brandColour};height:4px;"></td></tr>
  <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
    <p>A new submission has been received for <strong>${tender.title}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Subcontractor</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">${invitation.invitee_name}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Submitted</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;">${new Date().toLocaleDateString('en-NZ')}</td></tr>
      <tr><td style="padding:8px 0;font-size:13px;color:#6b7280;">Price</td>
          <td style="padding:8px 0;font-weight:600;">${price}</td></tr>
    </table>
    <p style="font-size:13px;color:#6b7280;">Log in to view and score this submission.</p>
  </td></tr>
  <tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></body></html>`,
          });
        } catch (_e) { /* non-blocking */ }
      }

      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('[tenderPublicApi] FATAL:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});