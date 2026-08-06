/**
 * recordSubmission — admin-authenticated recording of pricing that arrived
 * outside the tender portal (e.g. a subcontractor emails a PDF directly).
 *
 * The portal path (tenderPublicApi) is deliberately closed once a tender is
 * Closed/Cancelled or past its closing date — reopening it would also let
 * subcontractors themselves lodge late prices. This endpoint is the separate,
 * admin-only door: it writes the same shape of tender_submissions row the
 * portal would, but is allowed to do so after close (and warns via
 * received_after_close instead of blocking).
 *
 * Auth:   user JWT, role must be 'admin' or 'pricing' (matches manage:tenders).
 * Actions: upload | save | removeFile
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { escapeHtml } from '../_shared/escapeHtml.ts';
import { decodeBase64, base64ByteLength } from '../_shared/decodeBase64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const BUCKET = 'tender-submissions';
const ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'zip', 'csv', 'ppt', 'pptx'];
// The file travels here base64-encoded inside a JSON body, so the isolate holds the
// request buffer, the parsed string AND the decoded bytes at once (~3-4x the file
// size) against a 512 MB worker. Anything much past this is killed as HTTP 546 with
// no error body, so reject it up front with a message the admin can act on. This is
// deliberately lower than the app-wide 500 MB uploadFile() ceiling — that path streams
// straight to Storage from the browser and has no isolate in the middle.
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40 MB

// Same +12:00 convention as tenderPublicApi (tenderPublicApi/index.ts:403) — the app
// treats closing_date as end-of-day NZ time regardless of the server's local timezone.
function closingMs(closingDate: string): number {
  return new Date(`${closingDate.split('T')[0]}T23:59:59+12:00`).getTime();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt);
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { data: profile } = await supabaseAdmin.from('users').select('role, full_name, email').eq('id', authUser.id).single();
    if (!['admin', 'pricing'].includes(profile?.role || '')) {
      return Response.json({ error: `Forbidden — role '${profile?.role}'` }, { status: 403, headers: corsHeaders });
    }
    const adminName  = profile?.full_name || authUser.email || 'Admin';
    const adminEmail = profile?.email || authUser.email || '';

    const payload = await req.json();
    const { action } = payload;

    // ── UPLOAD ────────────────────────────────────────────────────────────────
    if (action === 'upload') {
      const { tenderId, fileName, fileData, fileType } = payload;
      if (!tenderId || !fileName || !fileData) {
        return Response.json({ error: 'tenderId, fileName and fileData are required' }, { status: 400, headers: corsHeaders });
      }

      const { data: tenderRow } = await supabaseAdmin.from('tenders').select('id').eq('id', tenderId).single();
      if (!tenderRow) return Response.json({ error: 'Tender not found' }, { status: 404, headers: corsHeaders });

      const ext = (fileName.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        return Response.json({ error: `File type .${ext} is not allowed. Accepted: ${ALLOWED_EXTS.join(', ')}` }, { status: 400, headers: corsHeaders });
      }

      // Size-check BEFORE decoding — decoding an oversized payload is exactly what
      // kills the worker, so the guard has to run on the encoded string.
      const declaredBytes = base64ByteLength(fileData);
      if (declaredBytes > MAX_UPLOAD_BYTES) {
        return Response.json({
          error: `File is ${(declaredBytes / 1024 / 1024).toFixed(1)} MB — recorded submissions are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB per file. Split it, compress it, or ask the subcontractor to lodge it through the tender portal link.`,
        }, { status: 400, headers: corsHeaders });
      }

      console.log(`[recordSubmission] UPLOAD START fileName=${fileName} fileType=${fileType} bytes=${declaredBytes}`);
      const binary = await decodeBase64(fileData);
      const mimeType = fileType || 'application/octet-stream';

      // 'manual' segment (instead of an invitation id) makes off-platform files
      // obvious when browsing the bucket. Never put the original filename in the key.
      const storagePath = `${tenderId}/manual/${Date.now()}_${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, binary, { contentType: mimeType, upsert: false });
      if (uploadError) {
        console.error('[recordSubmission] UPLOAD ERROR:', uploadError.message);
        return Response.json({ error: uploadError.message }, { status: 500, headers: corsHeaders });
      }

      const { data: signedData } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(storagePath, 3600, { download: fileName });

      return Response.json({
        storage_path: storagePath,
        file_name:    fileName,
        signed_url:   signedData?.signedUrl || null,
      }, { headers: corsHeaders });
    }

    // ── SAVE ──────────────────────────────────────────────────────────────────
    if (action === 'save') {
      const {
        tenderId, inviteeId, submissionId,
        priceLines, notes, files, receivedAt, notifySubcontractor,
      } = payload;

      if (!tenderId) return Response.json({ error: 'tenderId is required' }, { status: 400, headers: corsHeaders });
      if (!inviteeId) return Response.json({ error: 'inviteeId is required' }, { status: 400, headers: corsHeaders });

      const { data: tender } = await supabaseAdmin.from('tenders').select('*').eq('id', tenderId).single();
      if (!tender) return Response.json({ error: 'Tender not found' }, { status: 404, headers: corsHeaders });

      // Matches effectiveCanManage on the client (TenderDetail.jsx:340-341) — a tender
      // that has already been converted to a project is no longer editable at all.
      // Closed/Cancelled/past-closing-date are deliberately NOT blocked here: recording
      // a late arrival is the entire point of this endpoint.
      if (['Converted', 'Archived'].includes(tender.status)) {
        return Response.json({ error: `Cannot record a submission — this tender is ${tender.status}.` }, { status: 400, headers: corsHeaders });
      }

      const { data: invitee } = await supabaseAdmin.from('tender_invitees').select('*').eq('id', inviteeId).single();
      if (!invitee || invitee.tender_id !== tenderId) {
        return Response.json({ error: 'Invitee not found on this tender' }, { status: 400, headers: corsHeaders });
      }

      const { data: invitationRows } = await supabaseAdmin
        .from('tender_invitations')
        .select('*')
        .eq('tender_id', tenderId)
        .eq('invitee_id', inviteeId)
        .limit(1);
      const invitation: any = (invitationRows ?? [])[0] || null;

      const cleanLines: any[] = (priceLines || []).filter((l: any) => Number(l.amount) > 0);
      const lumpSum = cleanLines.reduce((sum: number, l: any) => sum + Number(l.amount), 0);
      if (!lumpSum || lumpSum <= 0) {
        return Response.json({ error: 'A valid price is required.' }, { status: 400, headers: corsHeaders });
      }

      const receivedAtIso = receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString();
      const nowIso = new Date().toISOString();
      const receivedAfterClose =
        ['Closed', 'Cancelled'].includes(tender.status) ||
        (!!tender.closing_date && new Date(receivedAtIso).getTime() > closingMs(tender.closing_date));

      const pricingFiles = (files || []).map((f: any) => ({
        file_url:    '',
        file_name:   f.file_name,
        storage_path: f.storage_path,
        uploaded_at: nowIso,
      }));

      // Rollback helper — best-effort cleanup of files uploaded THIS call if the
      // DB write below fails. garbageCollectFiles only scans the project-files
      // bucket (garbageCollectFiles/index.ts:50), so orphans here are permanent
      // unless we clean up ourselves. Mirrors src/api/supabaseClient.js removeFile().
      const rollbackFiles = async () => {
        for (const f of pricingFiles) {
          try { await supabaseAdmin.storage.from(BUCKET).remove([f.storage_path]); }
          catch (e: any) { console.warn('[recordSubmission] rollback cleanup failed', f.storage_path, e?.message); }
        }
      };

      const rowValues = {
        tender_id:          tenderId,
        invitee_id:         inviteeId,
        invitation_id:      invitation?.id || null,
        invitee_name:       invitee.full_name || '',
        invitee_email:      invitee.email || '',
        full_name:          invitee.full_name || '',
        business_name:      invitee.business_name || '',
        trade:              invitee.trade || '',
        lump_sum_price:     lumpSum,
        price_lines:        cleanLines,
        notes:              notes || '',
        pricing_files:      pricingFiles,
        uploaded_file_url:  pricingFiles[0]?.file_url  || '',
        uploaded_file_name: pricingFiles[0]?.file_name || '',
        submitted_at:       receivedAtIso,
        submission_source:  'manual',
        recorded_by_email:  adminEmail,
        recorded_by_name:   adminName,
        recorded_at:        nowIso,
        received_after_close: receivedAfterClose,
      };

      let existing: any = null;
      let priceBefore: number | null = null;

      if (submissionId) {
        const { data: row } = await supabaseAdmin.from('tender_submissions').select('*').eq('id', submissionId).single();
        if (!row || row.tender_id !== tenderId) {
          await rollbackFiles();
          return Response.json({ error: 'Submission not found on this tender' }, { status: 404, headers: corsHeaders });
        }
        existing = row;
      } else if (invitation) {
        const { data: rows } = await supabaseAdmin.from('tender_submissions').select('*').eq('invitation_id', invitation.id).limit(1);
        existing = (rows ?? [])[0] || null;
      } else {
        const { data: rows } = await supabaseAdmin.from('tender_submissions').select('*').eq('tender_id', tenderId).eq('invitee_id', inviteeId).limit(1);
        existing = (rows ?? [])[0] || null;
      }

      // On an edit, merge new files onto the existing ones rather than dropping them,
      // and never touch scores/outcome — scoring lives in ScoringPanel/OutcomePanel.
      let submission: any;
      if (existing) {
        priceBefore = existing.lump_sum_price;
        const mergedFiles = [...(existing.pricing_files || []), ...pricingFiles];
        const { data: updated, error: updErr } = await supabaseAdmin
          .from('tender_submissions')
          .update({
            ...rowValues,
            pricing_files:      mergedFiles,
            uploaded_file_url:  mergedFiles[0]?.file_url  || '',
            uploaded_file_name: mergedFiles[0]?.file_name || '',
          })
          .eq('id', existing.id)
          .select()
          .single();
        if (updErr) {
          console.error('[recordSubmission] UPDATE FAILED:', updErr.message);
          await rollbackFiles();
          return Response.json({ error: `Save failed: ${updErr.message}` }, { status: 500, headers: corsHeaders });
        }
        submission = updated;
      } else {
        const { data: created, error: insErr } = await supabaseAdmin
          .from('tender_submissions')
          .insert(rowValues)
          .select()
          .single();
        if (insErr) {
          console.error('[recordSubmission] INSERT FAILED:', insErr.message);
          await rollbackFiles();
          return Response.json({ error: `Save failed: ${insErr.message}` }, { status: 500, headers: corsHeaders });
        }
        submission = created;
      }

      // Status updates — check and log errors, never swallow silently (README rule).
      if (invitation) {
        const { error: invErr } = await supabaseAdmin
          .from('tender_invitations')
          .update({ status: 'Submitted', submitted_date: receivedAtIso })
          .eq('id', invitation.id);
        if (invErr) console.error('[recordSubmission] tender_invitations update failed:', invErr.message);
      }
      const { error: inviteeErr } = await supabaseAdmin
        .from('tender_invitees')
        .update({ status: 'Submitted' })
        .eq('id', inviteeId);
      if (inviteeErr) console.error('[recordSubmission] tender_invitees update failed:', inviteeErr.message);

      // Activity feed (non-blocking, but log failures).
      const activityDesc = existing
        ? `Manual submission updated for ${invitee.full_name} — price NZD ${Number(priceBefore || 0).toLocaleString('en-NZ', { minimumFractionDigits: 2 })} → NZD ${lumpSum.toLocaleString('en-NZ', { minimumFractionDigits: 2 })}`
        : `Pricing recorded on behalf of ${invitee.full_name}${invitee.business_name ? ` (${invitee.business_name})` : ''} — received ${receivedAtIso.split('T')[0]}, entered by ${adminName}`;
      const { error: activityErr } = await supabaseAdmin.from('tender_activity').insert({
        tender_id:   tenderId,
        event_type:  'submission_received',
        actor_name:  adminName,
        actor_email: adminEmail,
        description: activityDesc,
        occurred_at: nowIso,
      });
      if (activityErr) console.error('[recordSubmission] tender_activity insert failed:', activityErr.message);

      // Audit trail — this is what makes editing a recorded price safe.
      const { error: auditErr } = await supabaseAdmin.from('audit_logs').insert({
        action:        existing ? 'Submission Edited' : 'Submission Recorded Manually',
        entity_type:   'tender_submission',
        entity_id:     submission.id,
        user_id:       authUser.id,
        user_name:     adminName,
        description:   JSON.stringify({
          tender_id: tenderId,
          invitee:   invitee.full_name,
          price_before: priceBefore,
          price_after:  lumpSum,
          file_count:   pricingFiles.length,
        }),
        created_date:  nowIso,
      });
      if (auditErr) console.error('[recordSubmission] audit_logs insert failed:', auditErr.message);

      // Optional confirmation email — off by default, only sent if there's a live
      // portal link to point to (no token => no dead-link email).
      if (notifySubcontractor && invitation?.token && invitee.email) {
        try {
          const { data: branding } = await supabaseAdmin.from('email_branding').select('*').limit(1).single();
          const br: any = branding || {};
          const brandColour = br.brand_colour || '#1a56db';
          const fromName    = br.sender_name || br.company_name || 'ConstructIQ';
          const senderEmail = br.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
          const siteUrl     = Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app';
          const portalUrl   = `${siteUrl}/tender-submit/${invitation.token}`;
          const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));

          await resend.emails.send({
            from:    `${fromName} <${senderEmail}>`,
            to:      invitee.email,
            subject: `Tender Submission Received — ${tender.tender_number || ''}: ${tender.title}`,
            html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px 16px;">
<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <tr><td style="background:${brandColour};height:4px;"></td></tr>
  <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
    <p>Dear <strong>${escapeHtml(invitee.full_name)}</strong>,</p>
    <p>Thank you for submitting your pricing for <strong>${escapeHtml(tender.title)}</strong>.</p>
    <p>Your submission has been received. We will be in touch following the closing date${tender.closing_date ? ' of <strong>' + tender.closing_date + '</strong>' : ''}.</p>
    <p style="margin-top:24px;">
      <a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:${brandColour};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Your Submission</a>
    </p>
    <p style="color:#6b7280;font-size:13px;">Regards,<br>${br.company_name || 'ConstructIQ'}</p>
  </td></tr>
  <tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></body></html>`,
          });
        } catch (e: any) {
          console.warn('[recordSubmission] confirmation email failed (non-blocking):', e?.message);
        }
      }

      return Response.json({ success: true, submission }, { headers: corsHeaders });
    }

    // ── REMOVE FILE ───────────────────────────────────────────────────────────
    if (action === 'removeFile') {
      const { submissionId, storage_path } = payload;
      if (!submissionId || !storage_path) {
        return Response.json({ error: 'submissionId and storage_path are required' }, { status: 400, headers: corsHeaders });
      }

      const { data: submission } = await supabaseAdmin.from('tender_submissions').select('*').eq('id', submissionId).single();
      if (!submission) return Response.json({ error: 'Submission not found' }, { status: 404, headers: corsHeaders });

      const existingFiles: any[] = submission.pricing_files || [];
      const isReferenced = existingFiles.some((f: any) => f.storage_path === storage_path);
      if (!isReferenced) {
        // Never delete a path just because the caller supplied it — it must actually
        // belong to this submission.
        return Response.json({ error: 'That file is not part of this submission' }, { status: 400, headers: corsHeaders });
      }

      const remainingFiles = existingFiles.filter((f: any) => f.storage_path !== storage_path);
      const { error: updErr } = await supabaseAdmin
        .from('tender_submissions')
        .update({
          pricing_files:      remainingFiles,
          uploaded_file_url:  remainingFiles[0]?.file_url  || '',
          uploaded_file_name: remainingFiles[0]?.file_name || '',
        })
        .eq('id', submissionId);
      if (updErr) {
        console.error('[recordSubmission] removeFile DB update failed:', updErr.message);
        return Response.json({ error: `Failed to update submission: ${updErr.message}` }, { status: 500, headers: corsHeaders });
      }

      const { error: rmErr } = await supabaseAdmin.storage.from(BUCKET).remove([storage_path]);
      if (rmErr) console.error('[recordSubmission] removeFile storage delete failed:', rmErr.message);

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders });

  } catch (error: any) {
    console.error('[recordSubmission] FATAL:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
