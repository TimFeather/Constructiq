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
 *   4. We create the auth user ALREADY CONFIRMED via the service role (which
 *      bypasses the disabled-signup setting) — see "Why no verification email"
 *      below. handle_new_user inserts public.users (role 'external'); we fill in
 *      the profile fields. full_name is a GENERATED column — never written.
 *   5. Register.jsx signs the user straight in with the password they just chose.
 *      On that first login processPendingAssignments activates assignments and
 *      marks the invite Accepted.
 *
 * Why no verification email:
 *   This used to create the user UNCONFIRMED and email a Supabase confirmation
 *   link (auth/v1/verify). That link is a GET consumed by the FIRST request to
 *   it, and corporate mail security (M365 Safe Links, Mimecast, Barracuda —
 *   near-universal among subcontractors) pre-fetches links in email, burning the
 *   token before the human clicks. The victim then landed on '/' carrying an
 *   #error=otp_expired fragment that nothing rendered, couldn't log in ("Email
 *   not confirmed"), and couldn't re-register (409) — a total dead end with no
 *   resend path. It cost us real suppliers.
 *   Confirming here loses nothing: the invite token was itself delivered to that
 *   mailbox, which is the same proof of address ownership the confirmation email
 *   was collecting. See also the unconfirmed-account recovery branch below.
 *
 * Auth: none required (the registrant has no session yet). The invite token is
 * the authorization. No service-role secret is ever exposed to the client.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_URL = Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app';
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
    // Two possible token sources, both uuid so there's no ambiguity between them:
    //   invited_users     — staff invites (Settings → People → Invite to ConstructIQ)
    //   tender_invitations — subcontractor tender invites, registering for the
    //                        first time off their "My Tenders" strip
    // A malformed (non-uuid) token makes Postgres throw a cast error on either
    // .eq('token', token) call; only `data` is destructured, so it stays null
    // and falls through to the same 403 either way.
    const { data: invite } = await supabaseAdmin
      .from('invited_users')
      .select('*')
      .eq('token', token)
      .maybeSingle();

    let email: string;
    // Where the client should land after signing in: a staff invitee belongs in
    // the app proper, a tender invitee in their own My Tenders index.
    let kind: 'staff' | 'tender' = 'staff';
    if (invite) {
      if (invite.status === 'Cancelled') {
        return Response.json({ error: 'This invitation has been cancelled.' }, { status: 403, headers: corsHeaders });
      }
      if (invite.token_expires_at && new Date(invite.token_expires_at) < new Date()) {
        return Response.json(
          { error: 'This invitation has expired. Please ask your administrator to resend it.' },
          { status: 403, headers: corsHeaders },
        );
      }
      email = normalizeEmail(invite.email);
    } else {
      // Not a staff invite — fall back to a tender invitation. That table has
      // no expiry column, by design: a sub registering off a years-old tender
      // link is harmless and gets a working account.
      const { data: invitation } = await supabaseAdmin
        .from('tender_invitations')
        .select('invitee_email')
        .eq('token', token)
        .maybeSingle();
      if (!invitation) {
        return Response.json(
          { error: 'This invitation link is not valid. Please ask your administrator to resend your invitation.' },
          { status: 403, headers: corsHeaders },
        );
      }
      email = normalizeEmail(invitation.invitee_email);
      kind = 'tender';
    }

    if (!email) {
      return Response.json({ error: 'This invitation has no email on file.' }, { status: 422, headers: corsHeaders });
    }

    // ── Existing account? ────────────────────────────────────────────────────
    // A live (confirmed) account is never touched — the holder of a tender token
    // must not be able to reset a working account's password, and tender tokens
    // never expire. An UNCONFIRMED account, though, is one nobody has ever been
    // able to log into: it can only have been created by someone holding this
    // same token, so completing it here grants no access that re-registering
    // wouldn't. That branch is the recovery path for everyone stranded by the
    // old verification-link flow.
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    const profileFields = { first_name, last_name, phone, business_name };
    const fullName = [first_name, last_name].filter(Boolean).join(' ') || email;
    const userMetadata = { first_name, last_name, full_name: fullName, phone, business_name };

    if (existing) {
      const { data: authRecord } = await supabaseAdmin.auth.admin.getUserById(existing.id);
      if (authRecord?.user?.email_confirmed_at) {
        return Response.json(
          { error: 'An account already exists for this email. Please log in — or use "Forgot password?" if you cannot remember your password.' },
          { status: 409, headers: corsHeaders },
        );
      }

      // Stranded half-registration: set the password they just chose and confirm.
      const { error: fixErr } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: userMetadata,
      });
      if (fixErr) {
        console.error('[registerInvited] could not complete unconfirmed account:', fixErr.message);
        return Response.json(
          { error: 'An account already exists for this email but could not be activated. Please contact your administrator.' },
          { status: 500, headers: corsHeaders },
        );
      }
      const { error: fixProfileErr } = await supabaseAdmin
        .from('users')
        .update(profileFields)
        .eq('id', existing.id);
      if (fixProfileErr) {
        console.warn('[registerInvited] profile update failed (non-fatal):', fixProfileErr.message);
      }
      return Response.json({ success: true, email, kind }, { headers: corsHeaders });
    }

    // ── Create the auth user, already confirmed ───────────────────────────────
    // Public signups are disabled; the admin API (service role) bypasses that.
    // email_confirm:true means the account is immediately usable — Register.jsx
    // signs them in with this same password on the response.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (createErr || !created?.user) {
      // An auth.users row without a matching public.users row lands here (the
      // existing-account check above reads public.users). Rare — a failed
      // handle_new_user trigger — but it must not read as a generic 500.
      const alreadyRegistered = /already (been )?registered|already exists/i.test(createErr?.message || '');
      console.error('[registerInvited] createUser failed:', createErr?.message);
      return Response.json(
        {
          error: alreadyRegistered
            ? 'An account already exists for this email. Please log in — or use "Forgot password?" if you cannot remember your password.'
            : (createErr?.message || 'Could not create your account.'),
        },
        { status: alreadyRegistered ? 409 : 500, headers: corsHeaders },
      );
    }
    // ── Fill in profile (full_name is GENERATED — do not write it) ───────────
    const { error: profileErr } = await supabaseAdmin
      .from('users')
      .update(profileFields)
      .eq('id', created.user.id);
    if (profileErr) {
      console.warn('[registerInvited] profile update failed (non-fatal):', profileErr.message);
    }
    // NB: the invitation is marked Accepted on first successful login
    // (processPendingAssignments), which Register.jsx triggers immediately.

    return Response.json({ success: true, email, kind }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[registerInvited] ERROR:', error?.message);
    return Response.json({ error: error?.message || String(error) }, { status: 500, headers: corsHeaders });
  }
});
