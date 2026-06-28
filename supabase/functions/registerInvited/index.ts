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
 *   4. We create the auth user with the service role (bypasses the disabled-signup
 *      setting) and email_confirm:true (the token already proves inbox access).
 *   5. handle_new_user trigger inserts public.users (role 'external'); we fill in
 *      the profile fields. full_name is a GENERATED column — never written.
 *   6. Invite marked Accepted. processPendingAssignments (run on first login from
 *      AuthContext) then activates any project assignments for this email.
 *
 * Auth: none required (the registrant has no session yet). The invite token is
 * the authorization. No service-role secret is ever exposed to the client.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

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
        { error: 'An account already exists for this email. Please log in instead.' },
        { status: 409, headers: corsHeaders },
      );
    }

    // ── Create the auth user (service role bypasses disabled public signups) ─
    const fullName = [first_name, last_name].filter(Boolean).join(' ') || email;
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // token already proves inbox access
      user_metadata: { first_name, last_name, full_name: fullName, phone, business_name },
    });
    if (createErr || !created?.user) {
      return Response.json(
        { error: createErr?.message || 'Could not create your account.' },
        { status: 500, headers: corsHeaders },
      );
    }

    // ── Fill in profile (full_name is GENERATED — do not write it) ───────────
    const { error: profileErr } = await supabaseAdmin
      .from('users')
      .update({ first_name, last_name, phone, business_name })
      .eq('id', created.user.id);
    if (profileErr) {
      console.warn('[registerInvited] profile update failed (non-fatal):', profileErr.message);
    }

    // ── Mark the invite accepted ─────────────────────────────────────────────
    await supabaseAdmin.from('invited_users').update({ status: 'Accepted' }).eq('id', invite.id);

    return Response.json({ success: true, email }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[registerInvited] ERROR:', error?.message);
    return Response.json({ error: error?.message || String(error) }, { status: 500, headers: corsHeaders });
  }
});
