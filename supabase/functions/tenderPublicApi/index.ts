/**
 * tenderPublicApi — clean architecture version
 *
 * Token lookup:  tender_invitations only (no legacy fallback)
 * Submission:    Creates TenderSubmission record
 * Status:        Updates TenderInvitation + TenderInvitee
 *
 * NOTE: This is a public endpoint (no auth required for get/submit/upload —
 * access is gated by the invitation token). CORS headers are included on all
 * responses.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { action, token, submission } = payload;

    console.log(`[tenderPublicApi] action=${action} token=${token?.slice(0, 8)}...`);

    if (!token) {
      return Response.json({ error: 'Token required' }, { status: 400, headers: corsHeaders });
    }

    // ── Token lookup via tender_invitations (single source of truth) ──────────
    const { data: invitationsData } = await supabaseAdmin
      .from('tender_invitations')
      .select('*')
      .eq('token', token);
    const invitation: any = (invitationsData ?? [])[0];

    if (!invitation) {
      return Response.json(
        { error: 'Invalid or expired link — invitation not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    const { data: tenderRows } = await supabaseAdmin
      .from('tenders')
      .select('*')
      .eq('id', invitation.tender_id)
      .order('created_at', { ascending: false })
      .limit(1);
    const tender: any = (tenderRows ?? [])[0];

    if (!tender) {
      return Response.json(
        { error: 'Tender not found. Please ask the sender to resend your invitation.' },
        { status: 404, headers: corsHeaders }
      );
    }

    console.log(`[tenderPublicApi] invitation id=${invitation.id} tender id=${tender.id} status=${tender.status}`);

    // ── UPLOAD ────────────────────────────────────────────────────────────────
    if (action === 'upload') {
      try {
        const { fileName, fileData, fileType } = payload;

        if (!fileName || !fileData) {
          return Response.json(
            { error: 'fileName and fileData required' },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[tenderPublicApi] UPLOAD START fileName=${fileName} fileType=${fileType} base64Length=${fileData?.length}`);

        const binary = Uint8Array.from(atob(fileData), (c) => c.charCodeAt(0));
        const mimeType = fileType || 'application/octet-stream';

        // Upload to Supabase Storage (tender-submissions bucket)
        const storagePath = `${invitation.tender_id}/${invitation.id}/${Date.now()}_${fileName}`;
        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
          .from('tender-submissions')
          .upload(storagePath, binary, { contentType: mimeType, upsert: false });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        // Generate signed URL with expiry matching tender closing date
        let expirySeconds = 30 * 24 * 60 * 60; // Default 30 days
        if (tender.closing_date) {
          const closingMs = new Date(`${tender.closing_date.split('T')[0]}T23:59:59+12:00`).getTime();
          const secondsUntilClose = Math.max(0, Math.floor((closingMs - Date.now()) / 1000));
          expirySeconds = Math.min(secondsUntilClose + 86400, 30 * 24 * 60 * 60); // Add 1 day buffer, max 30 days
        }

        const { data: { signedUrl }, error: signError } = await supabaseAdmin.storage
          .from('tender-submissions')
          .createSignedUrl(storagePath, expirySeconds);

        if (signError || !signedUrl) {
          throw new Error(`Failed to generate signed URL: ${signError?.message || 'unknown error'}`);
        }

        console.log(`[tenderPublicApi] UPLOAD SUCCESS file_url=${signedUrl.split('?')[0]}... expires=${expirySeconds}s`);

        return Response.json({ file_url: signedUrl }, { headers: corsHeaders });

      } catch (uploadError: any) {
        console.error(`[tenderPublicApi] UPLOAD ERROR: ${uploadError?.message}`, uploadError);
        return Response.json(
          { error: uploadError?.message || 'Upload failed' },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // ── GET ───────────────────────────────────────────────────────────────────
    if (action === 'get') {
      // Mark as Viewed if still Sent
      if (invitation.status === 'Sent') {
        await supabaseAdmin
          .from('tender_invitations')
          .update({ status: 'Viewed', opened_date: new Date().toISOString() })
          .eq('id', invitation.id);

        // Update TenderInvitee status too
        if (invitation.invitee_id) {
          await supabaseAdmin
            .from('tender_invitees')
            .update({ status: 'Viewed' })
            .eq('id', invitation.invitee_id)
            .then(({ error }) => {
              if (error) console.warn(`[tenderPublicApi] TenderInvitee Viewed update failed: ${error.message}`);
            });
        }
      }

      // Load existing submission if any
      let existingSubmission: any = null;
      try {
        const { data: subs } = await supabaseAdmin
          .from('tender_submissions')
          .select('*')
          .eq('invitation_id', invitation.id);
        if (subs && subs.length > 0) existingSubmission = subs[0];
      } catch (e: any) {
        console.warn(`[tenderPublicApi] TenderSubmission lookup failed: ${e.message}`);
      }

      // Load issued NTTs + their attachments for the Correspondence tab on the portal
      let issuedNotices: any[] = [];
      try {
        const { data: noticesData } = await supabaseAdmin
          .from('tender_notices')
          .select('id, notice_number, title, notice_type, issue_date, description, tender_notice_attachments(id, file_url, file_name)')
          .eq('tender_id', tender.id)
          .eq('status', 'Issued')
          .order('issue_date', { ascending: false });
        issuedNotices = (noticesData ?? []).map((n: any) => ({
          ...n,
          attachments: n.tender_notice_attachments ?? [],
        }));
      } catch (_e) { /* table may not exist yet — fail silently */ }

      return Response.json({
        tender: {
          id:              tender.id,
          title:           tender.title,
          description:     tender.description,
          closing_date:    tender.closing_date,
          site_visit_date: tender.site_visit_date || null,
          questions_date:  tender.questions_date  || null,
          trade_packages:  tender.trade_packages  || [],
          documents:       tender.documents       || [],
          location:        tender.location,
          tender_number:   tender.tender_number,
          status:          tender.status,
          client_name:     tender.client_name     || '',
          client_contact:  tender.client_contact  || '',
          client_email:    tender.client_email    || '',
          notices:         issuedNotices,
        },
        invitee: {
          full_name:     invitation.invitee_name  || '',
          email:         invitation.invitee_email || '',
          business_name: '',
          status:        invitation.status,
          submission:    existingSubmission,
        },
      }, { headers: corsHeaders });
    }

    // ── SUBMIT ────────────────────────────────────────────────────────────────
    if (action === 'submit') {
      if (tender.status !== 'Issued') {
        return Response.json({
          error: tender.status === 'Closed'
            ? 'This tender has been closed and is no longer accepting submissions.'
            : 'This tender is no longer accepting submissions.',
        }, { status: 400, headers: corsHeaders });
      }

      if (tender.closing_date) {
        const closingMs = new Date(`${tender.closing_date.split('T')[0]}T23:59:59+12:00`).getTime();
        if (!isNaN(closingMs) && Date.now() > closingMs) {
          return Response.json(
            { error: 'The closing date for this tender has passed.' },
            { status: 400, headers: corsHeaders }
          );
        }
      }

      if (!submission?.lump_sum_price) {
        return Response.json(
          { error: 'Lump sum price is required.' },
          { status: 400, headers: corsHeaders }
        );
      }

      const submittedAt = new Date().toISOString();

      // Fetch invitee snapshot for historical integrity
      let inviteeSnapshot: Record<string, string> = {};
      if (invitation.invitee_id) {
        try {
          const { data: inviteeRows } = await supabaseAdmin
            .from('tender_invitees')
            .select('*')
            .eq('id', invitation.invitee_id);
          const inv: any = (inviteeRows ?? [])[0];
          if (inv) {
            inviteeSnapshot = {
              full_name:     inv.full_name     || invitation.invitee_name  || '',
              business_name: inv.business_name || '',
              trade:         inv.trade         || '',
            };
          }
        } catch (e: any) {
          console.warn(`[tenderPublicApi] invitee snapshot fetch failed: ${e.message}`);
        }
      }

      // Upsert TenderSubmission
      let submissionRecord: any;
      try {
        const { data: existingData } = await supabaseAdmin
          .from('tender_submissions')
          .select('*')
          .eq('invitation_id', invitation.id);
        const existing: any[] = existingData ?? [];

        if (existing.length > 0) {
          const { data: updated } = await supabaseAdmin
            .from('tender_submissions')
            .update({
              lump_sum_price:     submission.lump_sum_price,
              notes:              submission.notes              || '',
              uploaded_file_url:  submission.uploaded_file_url  || '',
              uploaded_file_name: submission.uploaded_file_name || '',
              submitted_at:       submittedAt,
              // re-snapshot in case invitee details were corrected before resubmission
              ...inviteeSnapshot,
            })
            .eq('id', existing[0].id)
            .select()
            .single();
          submissionRecord = updated;
          console.log(`[tenderPublicApi] TenderSubmission UPDATED id=${existing[0].id}`);
        } else {
          const { data: created } = await supabaseAdmin
            .from('tender_submissions')
            .insert({
              tender_id:          tender.id,
              invitee_id:         invitation.invitee_id  || '',
              invitation_id:      invitation.id,
              invitee_name:       invitation.invitee_name  || '',
              invitee_email:      invitation.invitee_email || '',
              lump_sum_price:     submission.lump_sum_price,
              notes:              submission.notes              || '',
              uploaded_file_url:  submission.uploaded_file_url  || '',
              uploaded_file_name: submission.uploaded_file_name || '',
              submitted_at:       submittedAt,
              // snapshot invitee details for historical integrity
              ...inviteeSnapshot,
            })
            .select()
            .single();
          submissionRecord = created;
          console.log(`[tenderPublicApi] TenderSubmission CREATED id=${submissionRecord?.id}`);
        }
      } catch (e: any) {
        console.error(`[tenderPublicApi] TenderSubmission upsert failed: ${e.message}`);
        return Response.json(
          { error: `Submission save failed: ${e.message}` },
          { status: 500, headers: corsHeaders }
        );
      }

      // Update TenderInvitation status
      await supabaseAdmin
        .from('tender_invitations')
        .update({ status: 'Submitted', submitted_date: submittedAt })
        .eq('id', invitation.id);

      // Update TenderInvitee status
      if (invitation.invitee_id) {
        await supabaseAdmin
          .from('tender_invitees')
          .update({ status: 'Submitted' })
          .eq('id', invitation.invitee_id)
          .then(({ error }) => {
            if (error) console.warn(`[tenderPublicApi] TenderInvitee Submitted update failed: ${error.message}`);
          });
      }

      // Fetch branding for emails
      const { data: brandingsData } = await supabaseAdmin.from('email_branding').select('*');
      const brandings: any[] = brandingsData ?? [];
      const branding    = brandings[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';
      const fromName    = branding.sender_name || branding.company_name || 'ConstructIQ';
      const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
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

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // ── UPDATE INTENT ─────────────────────────────────────────────────────────
    if (action === 'updateIntent') {
      const { intent } = payload; // 'will_tender' | 'will_not_tender'
      if (!intent || !['will_tender', 'will_not_tender'].includes(intent)) {
        return Response.json({ error: 'intent must be will_tender or will_not_tender' }, { status: 400, headers: corsHeaders });
      }

      // Don't allow changing intent on a submitted invitation
      if (invitation.status === 'Submitted') {
        return Response.json({ error: 'Cannot change intent after submitting pricing.' }, { status: 400, headers: corsHeaders });
      }

      const newStatus = intent === 'will_not_tender' ? 'Declined' : 'Viewed';
      await supabaseAdmin
        .from('tender_invitations')
        .update({ status: newStatus })
        .eq('id', invitation.id);

      if (invitation.invitee_id) {
        await supabaseAdmin
          .from('tender_invitees')
          .update({ status: newStatus })
          .eq('id', invitation.invitee_id);
      }

      return Response.json({ success: true, status: newStatus }, { headers: corsHeaders });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders });

  } catch (error: any) {
    console.error('[tenderPublicApi] FATAL:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
