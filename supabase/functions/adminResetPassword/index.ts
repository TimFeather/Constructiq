/**
 * adminResetPassword
 *
 * Admin-only. Generates a one-time password-recovery link for an existing user
 * so an admin can reset the password of someone (e.g. a contractor) who can't
 * receive or use the self-service reset email. Uses the service-role key to call
 * auth.admin.generateLink — the link lands the recipient on /reset-password,
 * which spends the token when they submit a new password, exactly like the
 * self-service flow (requestPasswordReset). See _shared/passwordReset.ts.
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
import { createResetLink, sendPasswordResetEmail } from '../_shared/passwordReset.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app',
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
    const appUrl = Deno.env.get('APP_URL') || 'https://constructiq-beige.vercel.app';
    let actionLink: string;
    try {
      actionLink = await createResetLink(supabaseAdmin, target.email, appUrl);
    } catch (linkErr: any) {
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

      await sendPasswordResetEmail(supabaseAdmin, RESEND_API_KEY, {
        to:         target.email,
        name:       target.full_name || target.first_name || target.email,
        resetLink:  actionLink,
        senderName: callerProfile.full_name || `${callerProfile.first_name || ''} ${callerProfile.last_name || ''}`.trim() || 'Administrator',
        sentBy:     authUser.id,
      });
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
