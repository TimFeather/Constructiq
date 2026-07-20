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
import { escapeHtml } from '../_shared/escapeHtml.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

const DEFAULT_QUESTION_POSTED_TEMPLATE = {
  subject: 'New Tender Question — {tender_number}: {title}',
  body_html: `
<p>Hi,</p>
<p><strong>{invitee_name}</strong> ({invitee_email}) has submitted a question on tender <strong>{tender_number}: {title}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Subject</td><td style="padding:6px 0;font-weight:500;">{question_subject}</td></tr>
  <tr><td style="padding:6px 0;color:#6b7280;">From</td><td style="padding:6px 0;">{invitee_name} — {invitee_company}</td></tr>
</table>
<p style="color:#374151;"><strong>Question:</strong><br>{question_description}</p>
<p style="margin-top:24px;">
  <a href="{admin_url}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View &amp; Respond</a>
</p>`,
};

const DEFAULT_QUESTION_ANSWERED_TEMPLATE = {
  subject: 'Your question on {tender_number} has been answered',
  body_html: `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>Your question on tender <strong>{tender_number}: {title}</strong> has been answered.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
  <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Question</td><td style="padding:6px 0;font-weight:500;">{question_subject}</td></tr>
</table>
<p style="color:#374151;"><strong>Answer:</strong><br>{answer_text}</p>
<p style="margin-top:24px;">
  <a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View on Tender Portal</a>
</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br><strong>{sender_name}</strong><br>{sender_email}<br>{company_name}</p>`,
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { action, token, submission } = payload;

    console.log(`[tenderPublicApi] action=${action} token=${token?.slice(0, 8)}...`);

    // ── RESPOND TO QUESTION (admin shortcut — no invitation token needed) ─────
    // Called directly from TenderDetail.jsx admin view
    if (action === 'respondQuestion' && (!token || token === '__admin_reply__')) {
      const authHeader = req.headers.get('authorization');
      if (!authHeader) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      const jwtToken = authHeader.replace('Bearer ', '');
      const { data: { user: authUser }, error: authErr } = await supabaseAdmin.auth.getUser(jwtToken);
      if (authErr || !authUser) return Response.json({ error: 'Invalid token' }, { status: 401, headers: corsHeaders });
      const { data: userData } = await supabaseAdmin.from('users').select('role, full_name, email').eq('id', authUser.id).single();
      if (!['admin', 'pricing', 'internal'].includes(userData?.role || '')) return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });

      const { rfi_id, content, invitee_email, invitee_name, tender_id: payloadTenderId } = payload;
      // Load tender + branding for email
      const { data: tRow } = await supabaseAdmin.from('tenders').select('id, tender_number, title').eq('id', payloadTenderId).single();
      const [{ data: bd }, { data: templates }] = await Promise.all([
        supabaseAdmin.from('email_branding').select('*').limit(1).single(),
        supabaseAdmin.from('email_templates').select('*').eq('template_key', 'tender_question_answered').limit(1),
      ]);
      const br: any = bd || {};
      const senderEmail = br.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
      const fromName    = br.sender_name || br.company_name || 'ConstructIQ';
      const { data: rfiRow } = await supabaseAdmin.from('tender_rfis').select('subject').eq('id', rfi_id).single();
      // Find the invitation token for the invitee to link back to portal
      const { data: invRows } = await supabaseAdmin.from('tender_invitations').select('token').eq('tender_id', payloadTenderId).eq('invitee_email', invitee_email).limit(1);
      const invToken = (invRows ?? [])[0]?.token;
      const portalUrl = invToken ? `${Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app'}/tender-submit/${invToken}` : '';

      try {
        const template = templates?.[0] || DEFAULT_QUESTION_ANSWERED_TEMPLATE;
        const vars: Record<string, string> = {
          invitee_name:     escapeHtml(invitee_name || ''),
          tender_number:    escapeHtml(tRow?.tender_number || ''),
          title:            escapeHtml(tRow?.title || ''),
          question_subject: escapeHtml(rfiRow?.subject || ''),
          answer_text:      escapeHtml(content),
          submission_link:  portalUrl,
          sender_name:      escapeHtml(userData?.full_name || fromName),
          sender_email:     escapeHtml(userData?.email || senderEmail),
          company_name:     escapeHtml(br.company_name || fromName),
        };
        const subject = replaceVars(template.subject || '', vars);
        const bodyContent = replaceVars(template.body_html || template.body || '', vars);
        const htmlBody = buildWrapper(bodyContent, br);

        const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
        await resend.emails.send({
          from:    `${fromName} <${senderEmail}>`,
          to:      invitee_email,
          subject,
          html: htmlBody,
        });
      } catch (_e) { /* non-blocking */ }
      return Response.json({ success: true }, { headers: corsHeaders });
    }

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

    // Block mutations on closed/cancelled tenders
    if (['Closed', 'Cancelled'].includes(tender.status) && ['submit', 'createQuestion', 'upload'].includes(action)) {
      return Response.json(
        { error: 'This tender is no longer accepting submissions or questions.' },
        { status: 400, headers: corsHeaders }
      );
    }

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

        // Validate type + size server-side. This is a public endpoint, so the
        // client's accept filter can't be trusted. Limits mirror the app-wide
        // uploadFile() validator (ALLOWED_UPLOAD_EXTS / 500 MB) exactly, so any
        // file the rest of ConstructIQ accepts is still accepted here — this only
        // rejects disallowed types and oversized/abusive uploads.
        const ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'zip', 'csv', 'ppt', 'pptx'];
        const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        if (!ALLOWED_EXTS.includes(ext)) {
          return Response.json(
            { error: `File type .${ext} is not allowed. Accepted: ${ALLOWED_EXTS.join(', ')}` },
            { status: 400, headers: corsHeaders }
          );
        }

        console.log(`[tenderPublicApi] UPLOAD START fileName=${fileName} fileType=${fileType} base64Length=${fileData?.length}`);

        const binary = Uint8Array.from(atob(fileData), (c) => c.charCodeAt(0));
        if (binary.length > MAX_UPLOAD_BYTES) {
          return Response.json(
            { error: `File exceeds 500 MB limit (${(binary.length / 1024 / 1024).toFixed(1)} MB)` },
            { status: 400, headers: corsHeaders }
          );
        }
        const mimeType = fileType || 'application/octet-stream';

        // Upload to Supabase Storage (tender-submissions bucket).
        // The storage key must never contain the original filename — Supabase
        // rejects keys that are too long or contain characters outside its
        // allowed set, and real-world construction filenames hit both. The
        // original name is kept in the submission row (file_name) and restored
        // at download time via the signed URL's `download` option.
        const storagePath = `${invitation.tender_id}/${invitation.id}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
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
          .createSignedUrl(storagePath, expirySeconds, { download: fileName });

        if (signError || !signedUrl) {
          throw new Error(`Failed to generate signed URL: ${signError?.message || 'unknown error'}`);
        }

        console.log(`[tenderPublicApi] UPLOAD SUCCESS file_url=${signedUrl.split('?')[0]}... expires=${expirySeconds}s`);

        // Return the signed URL (for immediate display on the portal) AND the storage
        // path. The path is the durable reference — signed URLs expire (~30 days max),
        // so admins regenerate fresh ones at scoring time via getSubmissionFileUrl.
        return Response.json({ file_url: signedUrl, storage_path: storagePath }, { headers: corsHeaders });

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

      // Load branding for portal header
      let portalBranding: any = {};
      try {
        const { data: bd } = await supabaseAdmin.from('email_branding').select('*').limit(1).single();
        if (bd) portalBranding = bd;
      } catch (_e) { /* fail silently */ }

      return Response.json({
        tender: {
          id:              tender.id,
          title:           tender.title,
          description:     tender.description,
          closing_date:    tender.closing_date,
          issue_date:      tender.issue_date || null,
          ths_rft_closing_date: tender.ths_rft_closing_date || '',
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
          additional_contacts: tender.additional_contacts || [],
          notices:         issuedNotices,
        },
        invitee: {
          full_name:     invitation.invitee_name  || '',
          email:         invitation.invitee_email || '',
          business_name: invitation.invitee_company || '',
          status:        invitation.status,
          submission:    existingSubmission,
        },
        issuer: {
          name:  tender.tender_lead_name  || tender.created_by_name  || '',
          email: tender.tender_lead_email || tender.created_by_email || '',
          phone: tender.tender_lead_phone || '',
        },
        branding: {
          company_name:  portalBranding.company_name  || '',
          logo_url:      portalBranding.logo_url      || null,
          brand_colour:  portalBranding.brand_colour  || '#1a56db',
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

      if (!submission?.lump_sum_price || Number(submission.lump_sum_price) <= 0) {
        return Response.json(
          { error: 'A valid price is required.' },
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

        // Build pricing_files array — merge new uploads with any passed in
        const pricingFiles: any[] = submission.pricing_files || [];
        // Backwards compat: if single file provided, wrap as first entry
        if (!pricingFiles.length && submission.uploaded_file_url) {
          pricingFiles.push({ file_url: submission.uploaded_file_url, file_name: submission.uploaded_file_name || 'pricing.pdf', uploaded_at: submittedAt });
        }
        const priceLines: any[] = submission.price_lines || [];

        if (existing.length > 0) {
          const { data: updated } = await supabaseAdmin
            .from('tender_submissions')
            .update({
              lump_sum_price:     submission.lump_sum_price,
              price_lines:        priceLines,
              notes:              submission.notes              || '',
              uploaded_file_url:  pricingFiles[0]?.file_url  || submission.uploaded_file_url  || '',
              uploaded_file_name: pricingFiles[0]?.file_name || submission.uploaded_file_name || '',
              pricing_files:      pricingFiles,
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
              price_lines:        priceLines,
              notes:              submission.notes              || '',
              uploaded_file_url:  pricingFiles[0]?.file_url  || submission.uploaded_file_url  || '',
              uploaded_file_name: pricingFiles[0]?.file_name || submission.uploaded_file_name || '',
              pricing_files:      pricingFiles,
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
    <p>Dear <strong>${escapeHtml(invitation.invitee_name)}</strong>,</p>
    <p>Thank you for submitting your pricing for <strong>${escapeHtml(tender.title)}</strong>.</p>
    <p>Your submission has been received. We will be in touch following the closing date${tender.closing_date ? ' of <strong>' + tender.closing_date + '</strong>' : ''}.</p>
    <p style="color:#6b7280;font-size:13px;">Regards,<br>${branding.company_name || 'ConstructIQ'}</p>
  </td></tr>
  <tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></body></html>`,
          });
        } catch (_e) { /* non-blocking */ }
      }

      // Notify tender lead + creator (dedup if same address)
      const internalRecipients = [...new Set([tender.tender_lead_email, tender.created_by_email].filter(Boolean))];
      for (const internalRecipient of internalRecipients) {
        try {
          const price = `NZD ${Number(submission.lump_sum_price).toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`;
          await resend.emails.send({
            from:    fromEmail,
            to:      internalRecipient,
            subject: `New Submission — ${tender.title}`,
            html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px 16px;">
<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <tr><td style="background:${brandColour};height:4px;"></td></tr>
  <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
    <p>A new submission has been received for <strong>${tender.title}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:13px;color:#6b7280;">Subcontractor</td>
          <td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-weight:600;">${escapeHtml(invitation.invitee_name)}</td></tr>
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

      // Log submission to activity feed (non-blocking)
      supabaseAdmin.from('tender_activity').insert({
        tender_id:   tender.id,
        event_type:  'submission_received',
        actor_name:  invitation.invitee_name || invitation.invitee_email,
        actor_email: invitation.invitee_email,
        description: `Submission received from ${invitation.invitee_name || invitation.invitee_email}${invitation.invitee_company ? ` (${invitation.invitee_company})` : ''}`,
        occurred_at: new Date().toISOString(),
      }).then(() => {});

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

    // ── LIST QUESTIONS ────────────────────────────────────────────────────────
    if (action === 'listQuestions') {
      const { data: questions } = await supabaseAdmin
        .from('tender_rfis')
        .select('*, tender_rfi_responses(*)')
        .eq('tender_id', tender.id)
        .order('created_at', { ascending: false });

      // Clarifications are shared with all bidders (standard tender practice), but
      // the ASKER's identity must never leak to competitors. Strip author PII and
      // expose only the Q&A content + an is_mine flag for the requesting invitee.
      const myEmail = (invitation.invitee_email || '').toLowerCase();
      const safeQuestions = (questions ?? []).map((q: any) => ({
        id:          q.id,
        subject:     q.subject,
        description: q.description,
        status:      q.status,
        created_at:  q.created_at,
        is_mine:     (q.created_by_email || '').toLowerCase() === myEmail,
        tender_rfi_responses: (q.tender_rfi_responses ?? []).map((r: any) => ({
          id:          r.id,
          author_name: r.author_name, // the issuer answering — safe to show
          content:     r.content,
          created_at:  r.created_at,
        })),
      }));

      return Response.json({ questions: safeQuestions }, { headers: corsHeaders });
    }

    // ── CREATE QUESTION ───────────────────────────────────────────────────────
    if (action === 'createQuestion') {
      const { subject, description: qDesc } = payload;
      if (!subject?.trim()) {
        return Response.json({ error: 'Subject is required' }, { status: 400, headers: corsHeaders });
      }

      const { data: question, error: qErr } = await supabaseAdmin
        .from('tender_rfis')
        .insert({
          tender_id:        tender.id,
          invitation_id:    invitation.id,
          created_by_email: invitation.invitee_email,
          created_by_name:  invitation.invitee_name,
          subject:          subject.trim(),
          description:      qDesc?.trim() || null,
          status:           'Open',
        })
        .select()
        .single();

      if (qErr) {
        console.error('[tenderPublicApi] createQuestion failed:', qErr.message);
        return Response.json({ error: qErr.message }, { status: 500, headers: corsHeaders });
      }

      // Notify tender lead / creator
      try {
        const [{ data: bd }, { data: templates }] = await Promise.all([
          supabaseAdmin.from('email_branding').select('*').limit(1).single(),
          supabaseAdmin.from('email_templates').select('*').eq('template_key', 'tender_question_posted').limit(1),
        ]);
        const br: any = bd || {};
        const senderEmail = br.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
        const fromName    = br.sender_name || br.company_name || 'ConstructIQ';
        const toEmail     = tender.tender_lead_email || tender.created_by_email;
        const adminUrl    = `${Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app'}/tenders/${tender.id}?tab=questions`;
        const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));

        if (toEmail) {
          const template = templates?.[0] || DEFAULT_QUESTION_POSTED_TEMPLATE;
          const vars: Record<string, string> = {
            invitee_name:        escapeHtml(invitation.invitee_name || ''),
            invitee_email:       escapeHtml(invitation.invitee_email || ''),
            invitee_company:     escapeHtml(invitation.invitee_company || ''),
            tender_number:       escapeHtml(tender.tender_number || ''),
            title:               escapeHtml(tender.title || ''),
            question_subject:    escapeHtml(subject),
            question_description: escapeHtml(qDesc || ''),
            admin_url:           adminUrl,
          };
          const subjectLine = replaceVars(template.subject || '', vars);
          const bodyContent = replaceVars(template.body_html || template.body || '', vars);
          const htmlBody = buildWrapper(bodyContent, br);

          await resend.emails.send({
            from:    `${fromName} <${senderEmail}>`,
            to:      toEmail,
            subject: subjectLine,
            html: htmlBody,
          });
        }
      } catch (_e) { /* non-blocking */ }

      // Log to activity feed (non-blocking)
      supabaseAdmin.from('tender_activity').insert({
        tender_id:   tender.id,
        event_type:  'note_added',
        actor_name:  invitation.invitee_name || invitation.invitee_email,
        actor_email: invitation.invitee_email,
        description: `Question submitted: "${subject}"`,
        occurred_at: new Date().toISOString(),
      }).then(() => {});

      return Response.json({ question }, { headers: corsHeaders });
    }

    // ── RESPOND TO QUESTION ───────────────────────────────────────────────────
    // This action requires a valid user JWT (admin/pricing)
    if (action === 'respondQuestion') {
      const authHeader = req.headers.get('authorization');
      if (!authHeader) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }
      const jwtToken = authHeader.replace('Bearer ', '');
      const { data: { user: authUser }, error: authErr } = await supabaseAdmin.auth.getUser(jwtToken);
      if (authErr || !authUser) {
        return Response.json({ error: 'Invalid token' }, { status: 401, headers: corsHeaders });
      }
      const { data: userData } = await supabaseAdmin.from('users').select('role, full_name, email').eq('id', authUser.id).single();
      if (!['admin', 'pricing', 'internal'].includes(userData?.role || '')) {
        return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
      }

      const { rfi_id, content } = payload;
      if (!rfi_id || !content?.trim()) {
        return Response.json({ error: 'rfi_id and content required' }, { status: 400, headers: corsHeaders });
      }

      // Verify RFI belongs to this tender
      const { data: rfiRow } = await supabaseAdmin.from('tender_rfis').select('*').eq('id', rfi_id).eq('tender_id', tender.id).single();
      if (!rfiRow) {
        return Response.json({ error: 'Question not found' }, { status: 404, headers: corsHeaders });
      }

      const { data: response, error: rErr } = await supabaseAdmin
        .from('tender_rfi_responses')
        .insert({
          rfi_id,
          author_email: userData?.email || authUser.email,
          author_name:  userData?.full_name || '',
          content:      content.trim(),
        })
        .select()
        .single();

      if (rErr) {
        return Response.json({ error: rErr.message }, { status: 500, headers: corsHeaders });
      }

      // Mark RFI as Answered
      await supabaseAdmin.from('tender_rfis').update({ status: 'Answered', updated_at: new Date().toISOString() }).eq('id', rfi_id);

      // Email invitee
      try {
        const [{ data: bd }, { data: templates }] = await Promise.all([
          supabaseAdmin.from('email_branding').select('*').limit(1).single(),
          supabaseAdmin.from('email_templates').select('*').eq('template_key', 'tender_question_answered').limit(1),
        ]);
        const br: any = bd || {};
        const senderEmail = br.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
        const fromName    = br.sender_name || br.company_name || 'ConstructIQ';
        const portalUrl   = `${Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app'}/tender-submit/${token}`;
        const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));

        const template = templates?.[0] || DEFAULT_QUESTION_ANSWERED_TEMPLATE;
        const vars: Record<string, string> = {
          invitee_name:     escapeHtml(invitation.invitee_name || ''),
          tender_number:    escapeHtml(tender.tender_number || ''),
          title:            escapeHtml(tender.title || ''),
          question_subject: escapeHtml(rfiRow.subject || ''),
          answer_text:      escapeHtml(content),
          submission_link:  portalUrl,
          sender_name:      escapeHtml(userData?.full_name || fromName),
          sender_email:     escapeHtml(userData?.email || senderEmail),
          company_name:     escapeHtml(br.company_name || fromName),
        };
        const subjectLine = replaceVars(template.subject || '', vars);
        const bodyContent = replaceVars(template.body_html || template.body || '', vars);
        const htmlBody = buildWrapper(bodyContent, br);

        await resend.emails.send({
          from:    `${fromName} <${senderEmail}>`,
          to:      invitation.invitee_email,
          subject: subjectLine,
          html: htmlBody,
        });
      } catch (_e) { /* non-blocking */ }

      return Response.json({ response }, { headers: corsHeaders });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders });

  } catch (error: any) {
    console.error('[tenderPublicApi] FATAL:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
