/**
 * sendTenderReminders — Daily reminder emails for tenders closing tomorrow.
 *
 * Sends two types of email:
 *   1. To each invitee who has NOT yet submitted — reminder that tender closes tomorrow
 *   2. To all internal/admin users — summary of who has and hasn't submitted
 *
 * Triggered by pg_cron (see SQL below). Safe to call manually for testing.
 * Only processes tenders with status = 'Issued' closing tomorrow (NZT).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL          = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Allow either service-role call (from pg_cron) or authenticated admin call (manual test)
  const authHeader = req.headers.get('Authorization') || '';
  const isServiceRole = authHeader.includes(SERVICE_ROLE_KEY);

  if (!isServiceRole) {
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    const { data: profile } = await supabaseAdmin.from('users').select('role').eq('id', user.id).single();
    if (!['admin', 'pricing'].includes(profile?.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }
  }

  try {
    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

    // Get branding
    const { data: brandingsData } = await supabaseAdmin.from('email_branding').select('*').limit(1);
    const branding    = (brandingsData ?? [])[0] || {};
    const brandColour = branding.brand_colour || '#1a56db';
    const fromName    = branding.sender_name  || branding.company_name || 'ConstructIQ';
    const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
    const fromEmail   = `${fromName} <${senderEmail}>`;

    // Find tenders closing tomorrow (NZT = UTC+12)
    // "Tomorrow" in NZT = closing_date matches tomorrow's date in NZT
    const nowNZT       = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const tomorrowNZT  = new Date(nowNZT);
    tomorrowNZT.setUTCDate(tomorrowNZT.getUTCDate() + 1);
    const tomorrowDate = tomorrowNZT.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`[sendTenderReminders] Checking for tenders closing on ${tomorrowDate} (NZT)`);

    const { data: tenders } = await supabaseAdmin
      .from('tenders')
      .select('id, title, tender_number, closing_date')
      .eq('status', 'Issued')
      .like('closing_date', `${tomorrowDate}%`);

    if (!tenders || tenders.length === 0) {
      console.log('[sendTenderReminders] No tenders closing tomorrow');
      return Response.json({ processed: 0, inviteeEmails: 0, ownerEmails: 0 }, { headers: corsHeaders });
    }

    console.log(`[sendTenderReminders] Found ${tenders.length} tender(s) closing tomorrow`);

    let totalInviteeEmails = 0;
    let totalOwnerEmails   = 0;

    for (const tender of tenders) {
      // Get all invitations for this tender
      const { data: invitations } = await supabaseAdmin
        .from('tender_invitations')
        .select('invitee_email, invitee_name, token, status')
        .eq('tender_id', tender.id);

      const allInvitations  = invitations ?? [];
      const pending         = allInvitations.filter((i: any) => !['Submitted', 'Awarded', 'Unsuccessful', 'Declined'].includes(i.status));
      const submitted       = allInvitations.filter((i: any) => ['Submitted', 'Awarded', 'Unsuccessful'].includes(i.status));
      const closingFormatted = tender.closing_date
        ? new Date(tender.closing_date).toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : 'tomorrow';

      // 1. Send reminder to each invitee who hasn't submitted
      for (const inv of pending) {
        if (!inv.invitee_email) continue;
        const portalUrl = `${APP_URL}/tender-submit/${inv.token}`;
        try {
          await resend.emails.send({
            from:    fromEmail,
            to:      inv.invitee_email,
            subject: `Reminder: ${tender.title} closes tomorrow`,
            html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px 16px;">
<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <tr><td style="background:${brandColour};height:4px;"></td></tr>
  <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
    <p>Dear <strong>${inv.invitee_name || 'Tenderer'}</strong>,</p>
    <p>This is a reminder that the tender <strong>${tender.title}</strong>${tender.tender_number ? ` (${tender.tender_number})` : ''} closes tomorrow.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#fef3c7;border-radius:6px;border:1px solid #fcd34d;">
      <tr><td style="padding:12px 16px;font-weight:600;color:#92400e;">⏰ Closing: ${closingFormatted}</td></tr>
    </table>
    <p>If you intend to submit pricing, please do so before the closing date and time.</p>
    <p style="margin:24px 0;">
      <a href="${portalUrl}" style="display:inline-block;background:${brandColour};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">View Tender & Submit →</a>
    </p>
    <p style="color:#6b7280;font-size:13px;">If you do not intend to tender, please indicate this via the portal.</p>
  </td></tr>
  <tr><td style="background:${brandColour};height:2px;"></td></tr>
  <tr><td style="padding:16px 40px;font-size:12px;color:#9ca3af;">Regards, ${fromName}</td></tr>
</table>
</body></html>`,
          });
          totalInviteeEmails++;
        } catch (e: any) {
          console.warn(`[sendTenderReminders] Invitee email failed to ${inv.invitee_email}:`, e?.message);
        }
      }

      // 2. Send summary to all internal/admin users
      const { data: internalUsers } = await supabaseAdmin
        .from('users')
        .select('email, full_name')
        .in('role', ['admin', 'pricing', 'internal'])
        .eq('disabled', false);

      if (!internalUsers || internalUsers.length === 0) continue;

      const submittedRows = submitted.map((i: any) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${i.invitee_name || i.invitee_email}</td>
             <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#059669;font-weight:600;">✓ Submitted</td></tr>`
      ).join('');

      const pendingRows = pending.map((i: any) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${i.invitee_name || i.invitee_email}</td>
             <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#dc2626;font-weight:600;">✗ Not yet submitted</td></tr>`
      ).join('');

      const summaryHtml = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f3f4f6;margin:0;padding:32px 16px;">
<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <tr><td style="background:${brandColour};height:4px;"></td></tr>
  <tr><td style="padding:32px 40px;font-size:15px;color:#111827;line-height:1.7;">
    <h2 style="margin:0 0 8px;font-size:18px;">Tender Closing Tomorrow</h2>
    <p style="margin:0 0 4px;color:#6b7280;font-size:14px;">${tender.tender_number ? tender.tender_number + ' — ' : ''}${tender.title}</p>
    <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">Closing: <strong>${closingFormatted}</strong></p>
    <p><strong>${submitted.length}</strong> of <strong>${allInvitations.length}</strong> invitees have submitted pricing.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
      <thead><tr style="background:#f9fafb;">
        <th style="padding:10px 12px;text-align:left;font-size:13px;color:#6b7280;">Invitee</th>
        <th style="padding:10px 12px;text-align:left;font-size:13px;color:#6b7280;">Status</th>
      </tr></thead>
      <tbody>${submittedRows}${pendingRows}</tbody>
    </table>
    <p style="margin:24px 0;">
      <a href="${APP_URL}/tenders/${tender.id}" style="display:inline-block;background:${brandColour};color:#ffffff;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:600;font-size:14px;">View Tender →</a>
    </p>
  </td></tr>
  <tr><td style="background:${brandColour};height:2px;"></td></tr>
  <tr><td style="padding:16px 40px;font-size:12px;color:#9ca3af;">ConstructIQ — automated reminder</td></tr>
</table>
</body></html>`;

      for (const staff of internalUsers) {
        if (!staff.email) continue;
        try {
          await resend.emails.send({
            from:    fromEmail,
            to:      staff.email,
            subject: `[Reminder] ${tender.title} closes tomorrow — ${submitted.length}/${allInvitations.length} submitted`,
            html:    summaryHtml,
          });
          totalOwnerEmails++;
        } catch (e: any) {
          console.warn(`[sendTenderReminders] Owner email failed to ${staff.email}:`, e?.message);
        }
      }

      // Audit log
      await supabaseAdmin.from('audit_logs').insert({
        action:      'Reminder Emails Sent',
        entity_type: 'Tender',
        entity_id:   tender.id,
        description: `Closing-tomorrow reminders: ${totalInviteeEmails} to invitees, ${totalOwnerEmails} to staff`,
        created_at:  new Date().toISOString(),
      }).then(() => {});
    }

    console.log(`[sendTenderReminders] Done — invitee emails: ${totalInviteeEmails}, owner emails: ${totalOwnerEmails}`);
    return Response.json({ processed: tenders.length, inviteeEmails: totalInviteeEmails, ownerEmails: totalOwnerEmails }, { headers: corsHeaders });

  } catch (err: any) {
    console.error('[sendTenderReminders] ERROR:', err?.message);
    return Response.json({ error: err?.message }, { status: 500, headers: corsHeaders });
  }
});
