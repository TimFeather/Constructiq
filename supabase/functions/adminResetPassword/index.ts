/**
 * adminResetPassword
 *
 * Admin-only. Generates a one-time password-recovery link for an existing user
 * so an admin can reset the password of someone (e.g. a contractor) who can't
 * receive or use the self-service reset email. Uses the service-role key to call
 * auth.admin.generateLink — the link lands the recipient on /reset-password with
 * a recovery session, exactly like the self-service flow.
 *
 * Payload: { userId, send }
 *   userId — the public.users / auth id of the target user
 *   send   — when true, also email the link to the user (customisable
 *            `password_reset` template); when false/omitted, just return the
 *            link for the admin to copy and deliver themselves.
 *
 * Returns: { action_link, email, sent }
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { sendTrackedEmail } from '../_shared/emailLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Plain-text/HTML fallback mirroring lib/emailTemplates.js password_reset content.
// A DB template (email_templates.template_key = 'password_reset') overrides this.
const DEFAULT_BODY = `
<p>Hi <strong>{name}</strong>,</p>
<p>A password reset was requested for your <strong>{company_name}</strong> account. Click the button below to set a new password.</p>
<p style="margin-top:24px;">
  <a href="{reset_link}" style="display:inline-block;padding:10px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">
    Set a new password
  </a>
</p>
<p style="font-size:13px;color:#6b7280;margin-top:16px;">
  This link can only be used once and will expire after a while. If you did not request this, you can safely ignore this email — your password will not change.
</p>`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // --- Authenticate caller ---
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('users').select('role, first_name, last_name, full_name').eq('id', authUser.id).single();
    if (callerProfile?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    // --- Resolve target user ---
    const { userId, send } = await req.json();
    if (!userId) {
      return Response.json({ error: 'userId required' }, { status: 400, headers: corsHeaders });
    }

    const { data: target, error: targetErr } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, first_name, disabled')
      .eq('id', userId)
      .single();
    if (targetErr || !target) {
      return Response.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
    }
    if (!target.email) {
      return Response.json({ error: 'User has no email address' }, { status: 400, headers: corsHeaders });
    }
    if (target.disabled === true) {
      return Response.json(
        { error: 'This user is deactivated. Reactivate them before resetting their password.' },
        { status: 400, headers: corsHeaders }
      );
    }

    // --- Generate the recovery link ---
    const appUrl = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: target.email,
      options: { redirectTo: `${appUrl}/reset-password` },
    });
    const actionLink = linkData?.properties?.action_link;
    if (linkErr || !actionLink) {
      console.error('[adminResetPassword] generateLink failed:', linkErr?.message);
      return Response.json(
        { error: linkErr?.message || 'Failed to generate reset link' },
        { status: 500, headers: corsHeaders }
      );
    }

    let sent = false;

    // --- Optionally email the link ---
    if (send) {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      if (!RESEND_API_KEY) {
        // Link still generated — surface the config gap without failing the whole call.
        return Response.json(
          { action_link: actionLink, email: target.email, sent: false,
            warning: 'RESEND_API_KEY not configured — link generated but email not sent.' },
          { headers: corsHeaders }
        );
      }

      const [{ data: templatesData }, { data: brandingsData }] = await Promise.all([
        supabaseAdmin.from('email_templates').select('*'),
        supabaseAdmin.from('email_branding').select('*'),
      ]);
      const tpl: any = (templatesData ?? []).find((t: any) => t.template_key === 'password_reset');
      const branding: any = (brandingsData ?? [])[0] || {};

      const brandColour = branding.brand_colour || '#1a56db';
      const companyName = branding.company_name || 'ConstructIQ';
      const fromName    = branding.sender_name || companyName;
      const senderEmail = branding.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
      const fromEmail   = `${fromName} <${senderEmail}>`;

      const vars: Record<string, string> = {
        name:         target.full_name || target.first_name || target.email,
        reset_link:   actionLink,
        company_name: companyName,
        sender_name:  callerProfile.full_name || `${callerProfile.first_name || ''} ${callerProfile.last_name || ''}`.trim() || 'Administrator',
      };
      const replace = (str: string) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

      const subject = tpl?.subject ? replace(tpl.subject) : 'Reset your ConstructIQ password';
      const rawBody = tpl?.body_html || DEFAULT_BODY;
      const bodyContent = replace(rawBody);
      const bodyText = replace(rawBody).replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

      const logoHtml = branding.logo_url
        ? `<div style="text-align:center;margin-bottom:20px;"><img src="${branding.logo_url}" alt="${companyName}" width="160" style="max-width:100%;height:auto;display:inline-block;" /></div>`
        : '';
      const footerHtml = branding.footer_text
        ? `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.6;">${branding.footer_text.replace(/\n/g, '<br>')}</div>`
        : '';

      const htmlBody = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Email</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:${brandColour};height:4px;"></td></tr>
        <tr><td style="padding:32px 40px;">
          ${logoHtml}
          <div style="font-size:15px;color:#111827;line-height:1.7;">${bodyContent}</div>
          ${footerHtml}
        </td></tr>
        <tr><td style="background:${brandColour};height:2px;"></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

      const resend = new Resend(RESEND_API_KEY);
      await sendTrackedEmail(
        resend,
        supabaseAdmin,
        { from: fromEmail, to: target.email, subject, html: htmlBody, text: bodyText },
        { kind: 'password_reset', sentBy: authUser.id },
      );
      sent = true;
      console.log(`[adminResetPassword] link emailed to ${target.email} by ${authUser.email}`);
    } else {
      console.log(`[adminResetPassword] link generated for ${target.email} by ${authUser.email} (copy mode)`);
    }

    return Response.json(
      { action_link: actionLink, email: target.email, sent },
      { headers: corsHeaders }
    );

  } catch (error: any) {
    console.error('[adminResetPassword] FATAL:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
