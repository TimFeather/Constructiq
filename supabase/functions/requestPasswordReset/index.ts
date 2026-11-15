/**
 * requestPasswordReset — self-service "Forgot password".
 *
 * Replaces supabase.auth.resetPasswordForEmail, whose email links to
 * auth/v1/verify and dies in corporate inboxes — see _shared/passwordReset.ts.
 * Sends the scanner-safe link through Resend with the customisable
 * `password_reset` template, the same email adminResetPassword sends.
 *
 * Payload: { email }
 * Returns { ok: true } whether or not an account exists, so the endpoint can't
 * be used to find out which addresses are registered.
 *
 * No account, but an invitation? Then the person was invited and never
 * registered — to them "I can't log in" looks like a forgotten password, and
 * sending nothing left them at a dead end (worse once the invite's 30 days
 * were up). They get the `account_setup` email instead: a fresh /register
 * link, sent only to the invited mailbox, so it grants nothing the original
 * invitation didn't. See sendSetupLinkIfInvited.
 *
 * Nothing is sent for unknown or deactivated accounts, or when one already went to that address in
 * the last minute: a new link invalidates the previous one, so a double-click
 * on "Send reset link" would otherwise kill the email the user is about to open.
 *
 * Errors return 500 so ForgotPassword falls back to Supabase's own email.
 *
 * Auth: none (the requester can't log in — that's the point). The gateway's
 * JWT check is satisfied by the anon key supabase-js attaches.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createResetLink, sendPasswordResetEmail, sendAccountSetupEmail } from '../_shared/passwordReset.ts';

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

const COOLDOWN_MS = 60_000;
const INVITE_EXPIRY_DAYS = 30;   // matches invitationService

/** True when an email of this kind went to the address within the cooldown. */
async function sentRecently(kind: string, recipient: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('email_messages')
    .select('id')
    .eq('kind', kind)
    .eq('recipient', recipient)
    .neq('status', 'failed')
    .gte('created_at', new Date(Date.now() - COOLDOWN_MS).toISOString())
    .limit(1);
  if (error) throw error;
  return !!data?.length;
}

/**
 * For an address with no account: if it holds a live invitation, email a
 * registration link. A staff/project invite (invited_users) wins over a tender
 * invitation, because registering with it lands the person in their project.
 * An expired invite token is renewed — the link only ever goes to the invited
 * mailbox, which is the same proof the original invitation relied on.
 * Cancelled invites are never revived.
 */
async function sendSetupLinkIfInvited(email: string, resendApiKey: string): Promise<void> {
  // Checked before anything is renewed, so a double-click can't rotate the
  // token out from under the email that's already on its way.
  if (await sentRecently('account_setup', email)) {
    console.log(`[requestPasswordReset] setup link already sent to ${email} within the last minute — skipped`);
    return;
  }

  // ilike + exact compare, as for the users lookup: no wildcards from the input.
  const { data: invites, error: inviteErr } = await supabaseAdmin
    .from('invited_users')
    .select('id, email, status, token, token_expires_at, resend_count')
    .ilike('email', email)
    .in('status', ['Pending', 'Expired'])
    .limit(5);
  if (inviteErr) throw inviteErr;
  const invite = (invites ?? []).find((i: any) => i.email?.toLowerCase() === email);

  let token: string | null = null;
  let name = email;

  if (invite) {
    token = invite.token;
    const live = token && invite.token_expires_at && new Date(invite.token_expires_at) > new Date();
    if (!live || invite.status !== 'Pending') {
      token = crypto.randomUUID();
      const now = new Date();
      const expires = new Date(now);
      expires.setDate(expires.getDate() + INVITE_EXPIRY_DAYS);
      const { error: renewErr } = await supabaseAdmin
        .from('invited_users')
        .update({
          status: 'Pending',
          token,
          token_created_at: now.toISOString(),
          token_expires_at: expires.toISOString(),
          last_invited_at: now.toISOString(),
          resend_count: (invite.resend_count || 0) + 1,
        })
        .eq('id', invite.id);
      if (renewErr) throw renewErr;
    }
    const { data: assignments } = await supabaseAdmin
      .from('pending_project_assignments')
      .select('full_name')
      .eq('invitation_id', invite.id)
      .neq('full_name', '')
      .limit(1);
    if (assignments?.[0]?.full_name) name = assignments[0].full_name;
  } else {
    const { data: tenderInvites, error: tenderErr } = await supabaseAdmin
      .from('tender_invitations')
      .select('token, invitee_email, invitee_name')
      .ilike('invitee_email', email)
      .order('created_at', { ascending: false })
      .limit(5);
    if (tenderErr) throw tenderErr;
    const tenderInvite = (tenderInvites ?? []).find((t: any) => t.invitee_email?.toLowerCase() === email);
    if (tenderInvite) {
      token = tenderInvite.token;
      if (tenderInvite.invitee_name) name = tenderInvite.invitee_name;
    }
  }

  if (!token) {
    console.log(`[requestPasswordReset] no account or invitation for ${email} — nothing sent`);
    return;
  }
  await sendAccountSetupEmail(supabaseAdmin, resendApiKey, {
    to: email,
    name,
    setupLink: `${APP_URL}/register?token=${encodeURIComponent(token)}`,
  });
  console.log(`[requestPasswordReset] no account for ${email} — account-setup link emailed`);
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const ok = () => Response.json({ ok: true }, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) return ok();

    // ilike for case-insensitivity; the exact match after it stops `_` or `*`
    // in an address acting as wildcards.
    const { data: candidates, error: lookupErr } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, first_name, disabled')
      .ilike('email', email)
      .limit(5);
    if (lookupErr) throw lookupErr;
    const target = (candidates ?? []).find((u: any) => u.email?.toLowerCase() === email);
    if (target?.disabled === true) {
      console.log(`[requestPasswordReset] account for ${email} is deactivated — nothing sent`);
      return ok();
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

    if (!target) {
      await sendSetupLinkIfInvited(email, RESEND_API_KEY);
      return ok();
    }

    if (await sentRecently('password_reset', target.email)) {
      console.log(`[requestPasswordReset] reset already sent to ${target.email} within the last minute — skipped`);
      return ok();
    }

    const resetLink = await createResetLink(supabaseAdmin, target.email, APP_URL);
    await sendPasswordResetEmail(supabaseAdmin, RESEND_API_KEY, {
      to: target.email,
      name: target.full_name || target.first_name || target.email,
      resetLink,
    });
    console.log(`[requestPasswordReset] reset link emailed to ${target.email}`);
    return ok();

  } catch (error: any) {
    console.error('[requestPasswordReset] FATAL:', error.message, error.stack);
    return Response.json({ error: 'Could not send the reset email' }, { status: 500, headers: corsHeaders });
  }
});
