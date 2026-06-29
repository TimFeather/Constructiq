/**
 * registerInvited — invite-only account creation.
 *
 * ConstructIQ is invite-only: public self-signup is disabled in Supabase Auth
 * ("Allow new users to sign up" = OFF). This function is the ONLY path that
 * creates a new account, and it only does so for someone who holds a valid
 * invitation token (delivered in their invite email link). Possession of the
 * token proves the registrant received the invite at that address.
 *
 * Flow:
 *   1. Client (Register.jsx) posts { token, password, profile fields }.
 *   2. We look up invited_users by token — must exist, not Cancelled, not expired.
 *   3. The email is taken from the invite row (NOT from the client) so a caller
 *      cannot register a different address than the one invited.
 *   4. We create the auth user UNCONFIRMED via the service role (bypasses the
 *      disabled-signup setting) and generate a confirmation link, which we email
 *      to the user (Supabase only auto-sends confirm emails on client signUp, which
 *      is disabled — so we send our own branded one via Resend).
 *   5. handle_new_user trigger inserts public.users (role 'external'); we fill in
 *      the profile fields. full_name is a GENERATED column — never written.
 *   6. The user clicks the link → email confirmed → signed in. On that first login
 *      processPendingAssignments activates assignments and marks the invite Accepted.
 *
 * Auth: none required (the registrant has no session yet). The invite token is
 * the authorization. No service-role secret is ever exposed to the client.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Resend } from 'npm:resend@4.0.0';
import { escapeHtml } from '../_shared/escapeHtml.ts';

const APP_URL = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
// Reflect localhost origins for dev; otherwise lock to the app origin.
function corsFor(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allow = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? origin : APP_URL;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body.token || '').trim();
    const password = String(body.password || '');
    const first_name = String(body.first_name || '').trim();
    const last_name = String(body.last_name || '').trim();
    const phone = String(body.phone || '').trim();
    const business_name = String(body.business_name || '').trim();

    if (!token) {
      return Response.json({ error: 'Missing invitation token.' }, { status: 400, headers: corsHeaders });
    }
    if (password.length < 8) {
      return Response.json({ error: 'Password must be at least 8 characters.' }, { status: 400, headers: corsHeaders });
    }

    // ── Validate the invitation ──────────────────────────────────────────────
    const { data: invite } = await supabaseAdmin
      .from('invited_users')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    if (!invite) {
      return Response.json(
        { error: 'This invitation link is not valid. Please ask your administrator to resend your invitation.' },
        { status: 403, headers: corsHeaders },
      );
    }
    if (invite.status === 'Cancelled') {
      return Response.json({ error: 'This invitation has been cancelled.' }, { status: 403, headers: corsHeaders });
    }
    if (invite.token_expires_at && new Date(invite.token_expires_at) < new Date()) {
      return Response.json(
        { error: 'This invitation has expired. Please ask your administrator to resend it.' },
        { status: 403, headers: corsHeaders },
      );
    }

    const email = normalizeEmail(invite.email);
    if (!email) {
      return Response.json({ error: 'This invitation has no email on file.' }, { status: 422, headers: corsHeaders });
    }

    // ── Don't recreate an existing account ───────────────────────────────────
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      return Response.json(
        { error: 'An account already exists for this email. If you have not verified yet, check your inbox for the verification link — otherwise please log in.' },
        { status: 409, headers: corsHeaders },
      );
    }

    // ── Create the auth user UNCONFIRMED + get a confirmation link ────────────
    // Public signups are disabled, so we use the admin API (service role bypasses
    // that). type:'signup' creates the user with the chosen password but leaves the
    // email unconfirmed and returns a confirmation action_link. Supabase only sends
    // its own confirmation email on client signUp (which is disabled), so we email
    // the link ourselves below. Clicking it confirms the email and signs them in.
    const fullName = [first_name, last_name].filter(Boolean).join(' ') || email;
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: {
        data: { first_name, last_name, full_name: fullName, phone, business_name },
        redirectTo: `${APP_URL}/`,
      },
    });
    if (linkErr || !linkData?.user) {
      return Response.json(
        { error: linkErr?.message || 'Could not create your account.' },
        { status: 500, headers: corsHeaders },
      );
    }
    const actionLink: string | undefined = (linkData as any).properties?.action_link;

    // ── Fill in profile (full_name is GENERATED — do not write it) ───────────
    const { error: profileErr } = await supabaseAdmin
      .from('users')
      .update({ first_name, last_name, phone, business_name })
      .eq('id', linkData.user.id);
    if (profileErr) {
      console.warn('[registerInvited] profile update failed (non-fatal):', profileErr.message);
    }
    // NB: the invitation is marked Accepted on first successful login
    // (processPendingAssignments), not here — the user hasn't verified yet.

    // ── Send the branded verification email ──────────────────────────────────
    if (!actionLink) {
      return Response.json(
        { error: 'Account created but no verification link was generated. Please contact your administrator.' },
        { status: 500, headers: corsHeaders },
      );
    }
    try {
      const { data: bd } = await supabaseAdmin.from('email_branding').select('*').limit(1).single();
      const br: any = bd || {};
      const senderEmail = br.sender_email || Deno.env.get('SENDER_EMAIL') || 'noreply@totalhomesolutions.co.nz';
      const fromName    = br.sender_name || br.company_name || 'ConstructIQ';
      const brandColour = br.brand_colour || '#1a56db';
      const logoHtml = br.logo_url
        ? `<div style="text-align:center;margin-bottom:20px;"><img src="${br.logo_url}" alt="${escapeHtml(br.company_name || 'Logo')}" width="160" style="max-width:100%;height:auto;display:inline-block;" /></div>`
        : '';
      const greeting = first_name ? `Hi <strong>${escapeHtml(first_name)}</strong>,` : 'Hi,';
      const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
      await resend.emails.send({
        from:    `${fromName} <${senderEmail}>`,
        to:      email,
        subject: 'Verify your email to activate your ConstructIQ account',
        html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
<tr><td style="background:${brandColour};height:4px;"></td></tr>
<tr><td style="padding:32px 40px;">
${logoHtml}
<div style="font-size:15px;color:#111827;line-height:1.7;">
<p>${greeting}</p>
<p>Welcome to ConstructIQ. Please verify your email address to activate your account and sign in.</p>
<p style="margin:28px 0;"><a href="${actionLink}" style="display:inline-block;padding:12px 28px;background:${brandColour};color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">Verify Email &amp; Sign In</a></p>
<p style="font-size:13px;color:#6b7280;">If the button doesn't work, copy and paste this link into your browser:<br><span style="word-break:break-all;color:#2563eb;">${actionLink}</span></p>
<p style="font-size:13px;color:#6b7280;">If you didn't expect this, you can ignore this email.</p>
</div>
</td></tr>
<tr><td style="background:${brandColour};height:2px;"></td></tr>
</table></td></tr></table></body></html>`,
      });
    } catch (e: any) {
      console.error('[registerInvited] verification email failed:', e?.message);
      return Response.json(
        { error: 'Your account was created but the verification email could not be sent. Please contact your administrator.' },
        { status: 500, headers: corsHeaders },
      );
    }

    return Response.json({ success: true, email }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[registerInvited] ERROR:', error?.message);
    return Response.json({ error: error?.message || String(error) }, { status: 500, headers: corsHeaders });
  }
});
