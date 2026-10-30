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
 * be used to find out which addresses are registered. Nothing is sent for
 * unknown or deactivated accounts, or when one already went to that address in
 * the last minute: a new link invalidates the previous one, so a double-click
 * on "Send reset link" would otherwise kill the email the user is about to open.
 *
 * Errors return 500 so ForgotPassword falls back to Supabase's own email.
 *
 * Auth: none (the requester can't log in — that's the point). The gateway's
 * JWT check is satisfied by the anon key supabase-js attaches.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createResetLink, sendPasswordResetEmail } from '../_shared/passwordReset.ts';

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
    if (!target || target.disabled === true) {
      console.log(`[requestPasswordReset] no active account for ${email} — nothing sent`);
      return ok();
    }

    const { data: recent, error: recentErr } = await supabaseAdmin
      .from('email_messages')
      .select('id')
      .eq('kind', 'password_reset')
      .eq('recipient', target.email)
      .neq('status', 'failed')
      .gte('created_at', new Date(Date.now() - COOLDOWN_MS).toISOString())
      .limit(1);
    if (recentErr) throw recentErr;
    if (recent?.length) {
      console.log(`[requestPasswordReset] reset already sent to ${target.email} within the last minute — skipped`);
      return ok();
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

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
