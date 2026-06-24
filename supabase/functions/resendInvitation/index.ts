/**
 * resendInvitation
 *
 * Finds the existing TenderInvitation for an invitee, generates a new token,
 * updates the invitation record, and resends the email.
 *
 * Payload: { inviteeId }
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
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();
    const user: any = { ...profile, id: authUser.id, email: authUser.email };

    if (!['admin', 'pricing'].includes(user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return Response.json(
        { error: 'RESEND_API_KEY not configured' },
        { status: 500, headers: corsHeaders }
      );
    }

    const { inviteeId } = await req.json();
    if (!inviteeId) {
      return Response.json({ error: 'inviteeId required' }, { status: 400, headers: corsHeaders });
    }

    // Load invitee
    const { data: inviteeRows } = await supabaseAdmin
      .from('tender_invitees')
      .select('*')
      .eq('id', inviteeId);
    const invitee: any = (inviteeRows ?? [])[0];
    if (!invitee) {
      return Response.json({ error: 'Invitee not found' }, { status: 404, headers: corsHeaders });
    }
    if (!invitee.email) {
      return Response.json({ error: 'Invitee has no email address' }, { status: 400, headers: corsHeaders });
    }

    const blockedStatuses = ['Submitted', 'Archived'];
    if (blockedStatuses.includes(invitee.status)) {
      return Response.json(
        { error: `Cannot resend invitation to a ${invitee.status} invitee` },
        { status: 400, headers: corsHeaders }
      );
    }

    // Load tender
    const { data: tenderRows } = await supabaseAdmin
      .from('tenders')
      .select('*')
      .eq('id', invitee.tender_id);
    const tender: any = (tenderRows ?? [])[0];
    if (!tender) {
      return Response.json({ error: 'Tender not found' }, { status: 404, headers: corsHeaders });
    }

    // Find existing TenderInvitation
    const { data: existingInvitationsData } = await supabaseAdmin
      .from('tender_invitations')
      .select('*')
      .match({ tender_id: invitee.tender_id, invitee_id: inviteeId });
    const existingInvitations: any[] = existingInvitationsData ?? [];

    const sentDate = new Date().toISOString();
    const newToken = crypto.randomUUID();
    let invitationRecord: any;

    if (existingInvitations.length > 0) {
      // Update existing invitation with a fresh token
      await supabaseAdmin
        .from('tender_invitations')
        .update({
          token:          newToken,
          status:         'Sent',
          sent_date:      sentDate,
          opened_date:    null,
          submitted_date: null,
        })
        .eq('id', existingInvitations[0].id);
      // Return full record for the link
      invitationRecord = { ...existingInvitations[0], token: newToken };
      console.log(`[resendInvitation] TenderInvitation UPDATED id=${existingInvitations[0].id} newToken=${newToken.slice(0, 8)}...`);
    } else {
      // Create a new invitation record if none exists
      const { data: created } = await supabaseAdmin
        .from('tender_invitations')
        .insert({
          token:         newToken,
          tender_id:     invitee.tender_id,
          invitee_id:    inviteeId,
          invitee_email: invitee.email,
          invitee_name:  invitee.full_name || '',
          status:        'Sent',
          sent_date:     sentDate,
        })
        .select()
        .single();
      invitationRecord = created;
      console.log(`[resendInvitation] TenderInvitation CREATED id=${invitationRecord?.id}`);
    }

    // Update invitee status back to Invited
    await supabaseAdmin
      .from('tender_invitees')
      .update({ status: 'Invited' })
      .eq('id', inviteeId);

    // Load branding + templates
    const [{ data: templatesData }, { data: brandingsData }] = await Promise.all([
      supabaseAdmin.from('email_templates').select('*'),
      supabaseAdmin.from('email_branding').select('*'),
    ]);
    const templates: any[] = templatesData ?? [];
    const brandings: any[] = brandingsData ?? [];
    const branding    = brandings[0] || {};
    const brandColour = branding.brand_colour || '#1a56db';
    const fromName    = branding.sender_name || branding.company_name || 'ConstructIQ';
    const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
    const fromEmail   = `${fromName} <${senderEmail}>`;
    const resend      = new Resend(RESEND_API_KEY);
    const tpl         = templates.find((t: any) => t.template_key === 'tender_invitation');
    const defaultBody = `You have been invited to submit pricing for {title}.\n\nPlease click the link below to view the tender documents and submit your pricing:\n\n{submission_link}\n\nClosing Date: {closing_date}\n\nRegards,\n{sender_name}`;

    const appUrl = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
    const submissionLink = `${appUrl}/tender-submit/${invitationRecord.token}`;

    const vars: Record<string, string> = {
      tender_number:   tender.tender_number || '',
      title:           tender.title || '',
      invitee_name:    invitee.full_name || '',
      company_name:    branding.company_name || 'ConstructIQ',
      location:        tender.location || '',
      closing_date:    tender.closing_date || '',
      trade_packages:  (tender.trade_packages || []).join(', '),
      description:     tender.description || '',
      submission_link: submissionLink,
      sender_name:     branding.sender_name || branding.company_name || 'ConstructIQ',
      sender_email:    senderEmail,
    };

    const replace = (str: string) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
    const rawBody = tpl?.body_html || tpl?.body_text || defaultBody;
    const subject = tpl?.subject ? replace(tpl.subject) : `Tender Invitation — ${vars.tender_number}: ${vars.title}`;
    const isHtml  = rawBody.trim().startsWith('<') || !!tpl?.body_html;
    const bodyContent = isHtml ? replace(rawBody) : replace(rawBody).replace(/\n/g, '<br>');
    const bodyText = replace(rawBody);

    const bodyWithCTA = `${!tpl ? `<p>Dear <strong>${invitee.full_name}</strong>,</p>` : ''}${bodyContent}
<p style="margin-top:24px;">
  <a href="${submissionLink}" style="display:inline-block;padding:10px 24px;background:${brandColour};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View Tender &amp; Submit Pricing</a>
</p>`;

    const logoHtml = branding.logo_url
      ? `<div style="text-align:left;margin-bottom:20px;"><img src="${branding.logo_url}" alt="${branding.company_name || 'Logo'}" width="160" style="max-width:100%;height:auto;display:inline-block;" /></div>`
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
                ${bodyWithCTA}
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

    await resend.emails.send({ from: fromEmail, to: invitee.email, subject, html: htmlBody, text: bodyText });
    console.log(`[resendInvitation] SENT to=${invitee.email} inviteeId=${inviteeId}`);

    return Response.json({ success: true, email: invitee.email }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[resendInvitation] FATAL:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
