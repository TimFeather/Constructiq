/**
 * issueNTT — Notice to Tenderers edge function
 *
 * Actions: createNotice | issueNotice | retryEmails | archiveNotice | updateCloseDate
 *
 * Requires authenticated session (admin/pricing role).
 * ADDITIVE: does not modify any existing tender, invitation, submission, or document logic.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_URL         = Deno.env.get('SITE_URL') || Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  // Verify the calling user is admin or pricing
  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  const { data: profileRow } = await supabaseAdmin
    .from('users').select('role, full_name').eq('id', user.id).single();
  if (!profileRow || !['admin', 'pricing'].includes(profileRow.role)) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
  }
  const issuerName = profileRow.full_name || user.email || 'Unknown';

  try {
    const payload = await req.json();
    const { action } = payload;

    console.log(`[issueNTT] action=${action} user=${user.id}`);

    // ── CREATE NOTICE ──────────────────────────────────────────────────────────
    if (action === 'createNotice') {
      const { tenderId, title, description, noticeType, attachments = [], proposedNewCloseDate = null } = payload;
      if (!tenderId || !title || !noticeType) {
        return Response.json({ error: 'tenderId, title, and noticeType are required' }, { status: 400, headers: corsHeaders });
      }

      // Generate NTT number server-side — transaction-safe sequential query
      const { data: existing } = await supabaseAdmin
        .from('tender_notices')
        .select('notice_number')
        .eq('tender_id', tenderId)
        .order('created_at', { ascending: false });

      let nextNum = 1;
      if (existing && existing.length > 0) {
        const nums = existing
          .map((r: any) => parseInt(r.notice_number?.replace('NTT-', '') || '0', 10))
          .filter((n: number) => !isNaN(n));
        if (nums.length > 0) nextNum = Math.max(...nums) + 1;
      }
      const noticeNumber = `NTT-${String(nextNum).padStart(3, '0')}`;

      const { data: notice, error: insertError } = await supabaseAdmin
        .from('tender_notices')
        .insert({
          tender_id:                tenderId,
          notice_number:            noticeNumber,
          title,
          description:              description || null,
          notice_type:              noticeType,
          status:                   'Draft',
          issued_by:                issuerName,
          proposed_new_close_date:  proposedNewCloseDate || null,
          created_at:               new Date().toISOString(),
          updated_at:               new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) throw new Error(insertError.message);

      // Insert attachments if any
      if (attachments.length > 0) {
        const attachRows = attachments.map((a: any) => ({
          notice_id: notice.id,
          file_url:  a.file_url  || null,
          file_name: a.file_name || null,
          superseded_document_id:    a.superseded_document_id    || null,
          replacement_document_id:   a.replacement_document_id   || null,
        }));
        await supabaseAdmin.from('tender_notice_attachments').insert(attachRows);
      }

      // Audit log
      await supabaseAdmin.from('audit_logs').insert({
        user_id:   user.id,
        action:    'NTT Created',
        entity_id: notice.id,
        details:   { notice_number: noticeNumber, tender_id: tenderId },
        created_at: new Date().toISOString(),
      }).then(() => {});

      return Response.json({ success: true, notice }, { headers: corsHeaders });
    }

    // ── ISSUE NOTICE ───────────────────────────────────────────────────────────
    if (action === 'issueNotice') {
      const { noticeId } = payload;
      if (!noticeId) return Response.json({ error: 'noticeId required' }, { status: 400, headers: corsHeaders });

      const { data: noticeRows, error: noticeErr } = await supabaseAdmin
        .from('tender_notices').select('*').eq('id', noticeId);
      if (noticeErr) return Response.json({ error: `DB error looking up notice: ${noticeErr.message}` }, { status: 500, headers: corsHeaders });
      const notice = noticeRows?.[0];
      if (!notice) return Response.json({ error: `Notice not found (id: ${noticeId})` }, { status: 404, headers: corsHeaders });
      if (notice.status === 'Issued') return Response.json({ error: 'Already issued' }, { status: 400, headers: corsHeaders });

      // Validate required fields
      if (!notice.title || !notice.notice_type) {
        return Response.json({ error: 'Title and notice type are required before issuing' }, { status: 400, headers: corsHeaders });
      }

      // Get tender + active invitees
      const { data: tenderRows, error: tenderErr } = await supabaseAdmin
        .from('tenders').select('*').eq('id', notice.tender_id);
      if (tenderErr) return Response.json({ error: `DB error looking up tender: ${tenderErr.message}` }, { status: 500, headers: corsHeaders });
      const tender = tenderRows?.[0];
      if (!tender) return Response.json({ error: 'Tender not found' }, { status: 404, headers: corsHeaders });

      const { data: invitations } = await supabaseAdmin
        .from('tender_invitations')
        .select('invitee_email, invitee_name, token')
        .eq('tender_id', notice.tender_id)
        .neq('status', 'Declined');
      const inviteeList: any[] = invitations ?? [];

      // Mark as Issued
      const issuedAt = new Date().toISOString();
      await supabaseAdmin
        .from('tender_notices')
        .update({ status: 'Issued', issue_date: issuedAt, updated_at: issuedAt })
        .eq('id', noticeId);

      // Get branding
      const { data: brandingsData } = await supabaseAdmin.from('email_branding').select('*');
      const branding    = (brandingsData ?? [])[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';
      const fromName    = branding.sender_name  || branding.company_name || 'ConstructIQ';
      const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
      const fromEmail   = `${fromName} <${senderEmail}>`;
      const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));

      // Send emails to all active invitees
      let sent = 0, failed = 0;
      const failedRecipients: string[] = [];

      // Load templates for NTT emails
      const { data: templatesData } = await supabaseAdmin.from('email_templates').select('*');
      const templates: any[] = templatesData ?? [];
      const tpl = templates.find((t: any) => t.template_key === 'tender_notice_issued');

      for (const inv of inviteeList) {
        if (!inv.invitee_email) continue;
        const portalUrl = `${SITE_URL}/tender-submit/${inv.token}`;
        const issueDate = notice.created_at ? new Date(notice.created_at).toLocaleDateString('en-NZ') : new Date().toLocaleDateString('en-NZ');

        const vars: Record<string, string> = {
          invitee_name:     inv.invitee_name || 'Tenderer',
          title:            tender.title || '',
          notice_number:    notice.notice_number || '',
          notice_type:      notice.notice_type || '',
          issue_date:       issueDate,
          submission_link:  portalUrl,
          company_name:     branding.company_name || 'ConstructIQ',
        };

        const replace = (str: string) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
        const rawBody = tpl?.body_html || `
<p>Dear <strong>{invitee_name}</strong>,</p>
<p>A new Notice to Tenderers has been issued for <strong>{title}</strong>.</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border-radius:6px;">
  <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Notice</td>
      <td style="padding:10px 14px;font-weight:600;">{notice_number}</td></tr>
  <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Type</td>
      <td style="padding:10px 14px;">{notice_type}</td></tr>
  <tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;">Issued</td>
      <td style="padding:10px 14px;">{issue_date}</td></tr>
</table>
<p style="color:#374151;">Please review the tender portal for full details and any attached documents.</p>
<p style="margin-top:24px;">
  <a href="{submission_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Tender Portal</a>
</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{company_name}</p>`;
        const bodyContent = replace(rawBody);
        const subject = tpl?.subject ? replace(tpl.subject) : `${tender.title} — ${notice.notice_number} Issued`;

        const logoHtml = branding.logo_url
          ? `<div style="text-align:center;margin-bottom:20px;"><img src="${branding.logo_url}" alt="${branding.company_name || 'Logo'}" width="160" style="max-width:100%;height:auto;display:inline-block;" /></div>`
          : '';
        const footerHtml = branding.footer_text
          ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.6;">${branding.footer_text.replace(/\n/g, '<br>')}</div>`
          : '';

        const htmlBody = `<!DOCTYPE html>
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

        try {
          await resend.emails.send({
            from:    fromEmail,
            to:      inv.invitee_email,
            subject,
            html:    htmlBody,
          });
          sent++;
        } catch (_e) {
          failed++;
          failedRecipients.push(inv.invitee_email);
        }
      }

      // Audit log — NTT Issued with email stats
      await supabaseAdmin.from('audit_logs').insert({
        user_id:   user.id,
        action:    'NTT Issued',
        entity_id: noticeId,
        details: {
          notice_number: notice.notice_number,
          tender_id:     notice.tender_id,
          emails_sent:   sent,
          emails_failed: failed,
          failed_recipients: failedRecipients,
        },
        created_at: issuedAt,
      }).then(() => {});

      return Response.json({
        success: true,
        emails_sent:   sent,
        emails_failed: failed,
        failed_recipients: failedRecipients,
      }, { headers: corsHeaders });
    }

    // ── RETRY FAILED EMAILS ────────────────────────────────────────────────────
    if (action === 'retryEmails') {
      const { noticeId, recipients } = payload;
      if (!noticeId || !recipients?.length) {
        return Response.json({ error: 'noticeId and recipients required' }, { status: 400, headers: corsHeaders });
      }

      const { data: notice } = await supabaseAdmin
        .from('tender_notices').select('*').eq('id', noticeId).single();
      if (!notice || notice.status !== 'Issued') {
        return Response.json({ error: 'Notice not found or not issued' }, { status: 404, headers: corsHeaders });
      }

      const { data: tender } = await supabaseAdmin
        .from('tenders').select('*').eq('id', notice.tender_id).single();
      if (!tender) {
        return Response.json({ error: 'Tender not found' }, { status: 404, headers: corsHeaders });
      }

      // Lookup tokens for failed recipients
      const { data: invitations } = await supabaseAdmin
        .from('tender_invitations')
        .select('invitee_email, invitee_name, token')
        .eq('tender_id', notice.tender_id)
        .in('invitee_email', recipients);

      const { data: brandingsData } = await supabaseAdmin.from('email_branding').select('*');
      const branding    = (brandingsData ?? [])[0] || {};
      const brandColour = branding.brand_colour || '#1a56db';
      const fromName    = branding.sender_name  || branding.company_name || 'ConstructIQ';
      const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
      const fromEmail   = `${fromName} <${senderEmail}>`;
      const resend      = new Resend(Deno.env.get('RESEND_API_KEY'));

      let sent = 0, failed = 0;
      for (const inv of (invitations ?? [])) {
        const portalUrl = `${SITE_URL}/tender-submit/${inv.token}`;
        try {
          await resend.emails.send({
            from: fromEmail, to: inv.invitee_email,
            subject: `${tender.title} — ${notice.notice_number} Issued (Retry)`,
            html: `<p>Please visit your <a href="${portalUrl}">tender portal</a> to view ${notice.notice_number}: ${notice.title}.</p>`,
          });
          sent++;
        } catch (_e) { failed++; }
      }

      await supabaseAdmin.from('audit_logs').insert({
        user_id: user.id, action: 'Email Distribution Completed',
        entity_id: noticeId,
        details: { retry: true, emails_sent: sent, emails_failed: failed },
        created_at: new Date().toISOString(),
      }).then(() => {});

      return Response.json({ success: true, emails_sent: sent, emails_failed: failed }, { headers: corsHeaders });
    }

    // ── ARCHIVE NOTICE ─────────────────────────────────────────────────────────
    if (action === 'archiveNotice') {
      const { noticeId } = payload;
      if (!noticeId) return Response.json({ error: 'noticeId required' }, { status: 400, headers: corsHeaders });

      const { data: notice } = await supabaseAdmin
        .from('tender_notices').select('status').eq('id', noticeId).single();
      if (!notice) return Response.json({ error: 'Notice not found' }, { status: 404, headers: corsHeaders });

      await supabaseAdmin
        .from('tender_notices')
        .update({ status: 'Archived', updated_at: new Date().toISOString() })
        .eq('id', noticeId);

      await supabaseAdmin.from('audit_logs').insert({
        user_id: user.id, action: 'NTT Archived', entity_id: noticeId,
        created_at: new Date().toISOString(),
      }).then(() => {});

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // ── UPDATE CLOSE DATE ──────────────────────────────────────────────────────
    if (action === 'updateCloseDate') {
      const { tenderId, newCloseDate, noticeId } = payload;
      if (!tenderId || !newCloseDate) {
        return Response.json({ error: 'tenderId and newCloseDate required' }, { status: 400, headers: corsHeaders });
      }

      await supabaseAdmin
        .from('tenders')
        .update({ closing_date: newCloseDate, updated_at: new Date().toISOString() })
        .eq('id', tenderId);

      await supabaseAdmin.from('audit_logs').insert({
        user_id: user.id, action: 'Close Date Changed', entity_id: tenderId,
        details: { new_close_date: newCloseDate, triggered_by_ntt: noticeId || null },
        created_at: new Date().toISOString(),
      }).then(() => {});

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400, headers: corsHeaders });

  } catch (error: any) {
    console.error('[issueNTT] FATAL:', error.message);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
