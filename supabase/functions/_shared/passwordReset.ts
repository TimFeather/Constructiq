/**
 * passwordReset
 *
 * Shared by requestPasswordReset (self-service) and adminResetPassword.
 *
 * Why we build the link instead of using generateLink's action_link:
 * action_link (and the link in Supabase's own reset email) points at
 * auth/v1/verify — a GET that spends the one-time token on the FIRST request.
 * Corporate mail security (M365 Safe Links, Mimecast, Barracuda) pre-fetches
 * links in email, so the token is burnt before the human clicks and they land
 * on "This reset link has expired". registerInvited documents the same failure
 * for confirmation emails. Our link carries only the hashed token to
 * /reset-password, which shows the new-password form and spends the token
 * (verifyOtp) when the user submits it. A scanner fetching the page changes
 * nothing.
 */
import { Resend } from 'npm:resend@4.0.0';
import { sendTrackedEmail } from './emailLog.ts';

/**
 * Generates a recovery token for `email` and returns the scanner-safe link.
 * Invalidates any earlier reset link for that user.
 */
export async function createResetLink(supabaseAdmin: any, email: string, appUrl: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    throw new Error(error?.message || 'Failed to generate reset link');
  }
  const params = new URLSearchParams({ token_hash: tokenHash, type: 'recovery' });
  return `${appUrl}/reset-password?${params}`;
}

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

export interface ResetEmail {
  to: string;
  name: string;
  resetLink: string;
  senderName?: string;        // {sender_name}; defaults to the company name
  sentBy?: string | null;     // users.id of the admin who sent it, if any
}

/**
 * Sends the branded `password_reset` email through Resend and logs it in
 * email_messages (kind 'password_reset'). Throws if the send failed.
 */
export async function sendPasswordResetEmail(
  supabaseAdmin: any,
  resendApiKey: string,
  { to, name, resetLink, senderName, sentBy = null }: ResetEmail,
): Promise<void> {
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
    name,
    reset_link:   resetLink,
    company_name: companyName,
    sender_name:  senderName || companyName,
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

  const resend = new Resend(resendApiKey);
  await sendTrackedEmail(
    resend,
    supabaseAdmin,
    { from: fromEmail, to, subject, html: htmlBody, text: bodyText },
    { kind: 'password_reset', sentBy },
  );
}
