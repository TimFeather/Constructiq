/**
 * sendOutcomeNotifications
 *
 * Sends outcome notifications (Awarded / Unsuccessful) to all subcontractors
 * for a given tender. All email processing is server-side via Resend.
 *
 * Input: { tenderId, retryFailedOnly? }
 *   retryFailedOnly: if true, only re-sends records where outcome_notification_status === 'Failed'
 *
 * Returns: { success, total, sent, failed, results[] }
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { logEmailSend } from '../_shared/emailLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── Inline template defaults (mirrors lib/emailTemplates.js) ─────────────────
const DEFAULT_TEMPLATES: Record<string, { subject: string; body_html: string }> = {
  tender_sub_awarded: {
    subject: 'Tender Award — {tender_number}: {title}',
    body_html: `<p>Dear <strong>{invitee_name}</strong>,</p>
<p>We are pleased to advise that following a review of all tender submissions for <strong>{title}</strong>, your submission has been selected.</p>
<p>We will be in touch shortly to discuss next steps and formalise the engagement.</p>
<p>Thank you for your submission and we look forward to working with you.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
  },
  tender_sub_unsuccessful: {
    subject: 'Tender Outcome — {tender_number}: {title}',
    body_html: `<p>Dear <strong>{invitee_name}</strong>,</p>
<p>Thank you for submitting your pricing for <strong>{title}</strong>.</p>
<p>After careful consideration of all submissions received, we regret to advise that your submission was not selected on this occasion.</p>
<p>We appreciate the time and effort you put into your submission and hope to have the opportunity to work with you in the future.</p>
<p style="margin-top:24px;color:#6b7280;font-size:13px;">Regards,<br>{sender_name}<br>{company_name}</p>`,
  },
};

function applyVars(template: { subject: string; body_html: string }, vars: Record<string, string>) {
  let subject = template.subject || '';
  let body    = template.body_html || '';
  Object.entries(vars).forEach(([k, v]) => {
    const re = new RegExp(`\\{${k}\\}`, 'g');
    subject = subject.replace(re, v ?? '');
    body    = body.replace(re, v ?? '');
  });
  return { subject, body };
}

function buildHtml(bodyHtml: string, branding: any = {}) {
  const brand  = branding.brand_colour || '#1a56db';
  const logo   = branding.logo_url
    ? `<div style="margin-bottom:20px;"><img src="${branding.logo_url}" height="40" alt="${branding.company_name || ''}" style="display:block;" /></div>`
    : '';
  const footer = branding.footer_text
    ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;">${branding.footer_text.replace(/\n/g, '<br>')}</div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <tr><td style="background:${brand};height:4px;"></td></tr>
      <tr><td style="padding:32px 40px;">${logo}<div style="font-size:15px;color:#111827;line-height:1.7;">${bodyHtml}</div>${footer}</td></tr>
      <tr><td style="background:${brand};height:2px;"></td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const log: string[] = [];
  const trace = (msg: string) => { console.log(`[sendOutcomeNotifications] ${msg}`); log.push(msg); };

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();
    const user: any = { ...profile, id: authUser.id, email: authUser.email };

    const body = await req.json();
    const { tenderId, retryFailedOnly = false } = body;

    if (!tenderId) {
      return Response.json({ error: 'tenderId is required' }, { status: 400, headers: corsHeaders });
    }

    trace(`tenderId=${tenderId} retryFailedOnly=${retryFailedOnly} invokedBy=${user.email}`);

    // ── Load data ─────────────────────────────────────────────────────────────
    const [
      { data: tenderData },
      { data: allSubmissionsData },
      { data: customTemplatesData },
      { data: brandingsData },
    ] = await Promise.all([
      supabaseAdmin.from('tenders').select('*').eq('id', tenderId).single(),
      supabaseAdmin.from('tender_submissions').select('*').eq('tender_id', tenderId),
      supabaseAdmin.from('email_templates').select('*'),
      supabaseAdmin.from('email_branding').select('*'),
    ]);

    const tender: any = tenderData;
    if (!tender) {
      return Response.json({ error: 'Tender not found' }, { status: 404, headers: corsHeaders });
    }

    const allSubmissions: any[] = allSubmissionsData ?? [];
    const customTemplates: any[] = customTemplatesData ?? [];
    const brandings: any[] = brandingsData ?? [];

    const branding  = brandings[0] || {};
    const fromName  = branding.sender_name || branding.company_name || 'ConstructIQ';
    const fromEmail = `${fromName} <noreply@totalhomesolutions.co.nz>`;
    const resend    = new Resend(Deno.env.get('RESEND_API_KEY'));

    // ── Filter which submissions to process ───────────────────────────────────
    let submissions = allSubmissions.filter((s: any) =>
      s.outcome === 'Awarded' || s.outcome === 'Unsuccessful'
    );

    if (retryFailedOnly) {
      submissions = submissions.filter((s: any) => s.outcome_notification_status === 'Failed');
      trace(`Retry mode: ${submissions.length} failed submission(s) to retry`);
    } else {
      trace(`Full send mode: ${submissions.length} submission(s) with outcomes`);
    }

    if (submissions.length === 0) {
      return Response.json(
        { success: true, total: 0, sent: 0, failed: 0, results: [], log },
        { headers: corsHeaders }
      );
    }

    // ── Resolve templates ─────────────────────────────────────────────────────
    const resolveTemplate = (key: string) => {
      const custom = customTemplates.find((t: any) => t.template_key === key);
      return custom || DEFAULT_TEMPLATES[key];
    };

    const results: any[] = [];
    let sent = 0;
    let failed = 0;

    for (const sub of submissions) {
      const outcome = sub.outcome;
      const tplKey  = outcome === 'Awarded' ? 'tender_sub_awarded' : 'tender_sub_unsuccessful';
      const template = resolveTemplate(tplKey);

      if (!sub.invitee_email) {
        trace(`SKIP sub.id=${sub.id} — no invitee_email`);
        const errMsg = 'No email address on submission';
        await supabaseAdmin.from('tender_submissions').update({
          outcome_notification_status: 'Failed',
          outcome_notification_type:   outcome,
          outcome_notification_error:  errMsg,
        }).eq('id', sub.id);
        results.push({ id: sub.id, email: null, outcome, status: 'Failed', error: errMsg });
        failed++;
        continue;
      }

      const { subject, body: bodyHtml } = applyVars(template, {
        tender_number: tender.tender_number || '',
        title:         tender.title || '',
        invitee_name:  sub.invitee_name || sub.full_name || '',
        sender_name:   user.full_name || '',
        company_name:  branding.company_name || 'ConstructIQ',
      });

      const html = buildHtml(bodyHtml, branding);

      trace(`Sending ${outcome} notification to ${sub.invitee_email} (sub.id=${sub.id})`);

      let result: any;
      try {
        result = await resend.emails.send({
          from:    fromEmail,
          to:      sub.invitee_email,
          subject,
          html,
        });
        trace(`Resend result for ${sub.invitee_email}: ${JSON.stringify(result)}`);
      } catch (sendErr: any) {
        trace(`Resend threw for ${sub.invitee_email}: ${sendErr.message}`);
        await supabaseAdmin.from('tender_submissions').update({
          outcome_notification_status: 'Failed',
          outcome_notification_type:   outcome,
          outcome_notification_error:  sendErr.message,
        }).eq('id', sub.id);
        results.push({ id: sub.id, email: sub.invitee_email, outcome, status: 'Failed', error: sendErr.message });
        failed++;
        await logEmailSend(supabaseAdmin, {
          resendId:  null,
          recipient: sub.invitee_email,
          subject,
          failure:   sendErr.message,
          context:   { kind: 'tender_outcome', tenderId, inviteeId: sub.invitee_id, sentBy: user.id },
        });

        // Log activity
        try {
          await supabaseAdmin.from('tender_activity').insert({
            tender_id:   tenderId,
            event_type:  'outcome_set',
            actor_name:  user.full_name || 'System',
            actor_email: user.email || '',
            description: `Outcome notification FAILED for ${sub.invitee_name || sub.invitee_email} (${outcome}) — ${sendErr.message}`,
            metadata:    { invitee_name: sub.invitee_name, invitee_email: sub.invitee_email, to: outcome },
            occurred_at: new Date().toISOString(),
          });
        } catch (_) { /* non-fatal */ }

        continue;
      }

      if (result?.data?.id) {
        // ── SUCCESS ────────────────────────────────────────────────────────────
        await supabaseAdmin.from('tender_submissions').update({
          outcome_notified_at:             new Date().toISOString(),
          outcome_notification_status:     'Sent',
          outcome_notification_type:       outcome,
          outcome_notification_message_id: result.data.id,
          outcome_notification_error:      null,
        }).eq('id', sub.id);
        sent++;
        await logEmailSend(supabaseAdmin, {
          resendId:  result.data.id,
          recipient: sub.invitee_email,
          subject,
          context:   { kind: 'tender_outcome', tenderId, inviteeId: sub.invitee_id, sentBy: user.id },
        });
        trace(`SUCCESS sub.id=${sub.id} messageId=${result.data.id}`);
        results.push({ id: sub.id, email: sub.invitee_email, outcome, status: 'Sent', messageId: result.data.id });

        try {
          await supabaseAdmin.from('tender_activity').insert({
            tender_id:   tenderId,
            event_type:  'outcome_set',
            actor_name:  user.full_name || 'System',
            actor_email: user.email || '',
            description: `Outcome notification sent to ${sub.invitee_name || sub.invitee_email} — ${outcome}${retryFailedOnly ? ' (retry)' : ''} [msgId: ${result.data.id}]`,
            metadata:    { invitee_name: sub.invitee_name, invitee_email: sub.invitee_email, to: outcome },
            occurred_at: new Date().toISOString(),
          });
        } catch (_) { /* non-fatal */ }

      } else {
        // ── FAIL — Resend returned no ID ──────────────────────────────────────
        const errMsg = result?.error?.message || 'Resend did not return a message ID';
        trace(`FAIL sub.id=${sub.id} — ${errMsg}`);
        await supabaseAdmin.from('tender_submissions').update({
          outcome_notification_status: 'Failed',
          outcome_notification_type:   outcome,
          outcome_notification_error:  errMsg,
        }).eq('id', sub.id);
        failed++;
        results.push({ id: sub.id, email: sub.invitee_email, outcome, status: 'Failed', error: errMsg });
        await logEmailSend(supabaseAdmin, {
          resendId:  null,
          recipient: sub.invitee_email,
          subject,
          failure:   errMsg,
          context:   { kind: 'tender_outcome', tenderId, inviteeId: sub.invitee_id, sentBy: user.id },
        });

        try {
          await supabaseAdmin.from('tender_activity').insert({
            tender_id:   tenderId,
            event_type:  'outcome_set',
            actor_name:  user.full_name || 'System',
            actor_email: user.email || '',
            description: `Outcome notification FAILED for ${sub.invitee_name || sub.invitee_email} (${outcome}) — ${errMsg}`,
            metadata:    { invitee_name: sub.invitee_name, invitee_email: sub.invitee_email, to: outcome },
            occurred_at: new Date().toISOString(),
          });
        } catch (_) { /* non-fatal */ }
      }
    }

    // ── Update tender status if any awarded ───────────────────────────────────
    if (!retryFailedOnly && sent > 0) {
      const anyAwarded = submissions.some((s: any) => s.outcome === 'Awarded');
      await supabaseAdmin.from('tenders').update({
        status:     anyAwarded ? 'Awarded' : 'Unsuccessful',
        award_date: anyAwarded ? new Date().toISOString().split('T')[0] : tender.award_date,
      }).eq('id', tenderId);
      trace(`Tender status updated to ${anyAwarded ? 'Awarded' : 'Unsuccessful'}`);
    }

    trace(`COMPLETE — total=${submissions.length} sent=${sent} failed=${failed}`);
    return Response.json(
      { success: true, total: submissions.length, sent, failed, results, log },
      { headers: corsHeaders }
    );

  } catch (error: any) {
    console.error(`[sendOutcomeNotifications] EXCEPTION: ${error.message}`, error.stack);
    return Response.json(
      { error: error.message, stack: error.stack, log },
      { status: 500, headers: corsHeaders }
    );
  }
});
