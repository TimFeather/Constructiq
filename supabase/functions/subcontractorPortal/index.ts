/**
 * subcontractorPortal — authenticated self-service for subcontractors.
 *
 * Companion to tenderPublicApi (which is token-scoped, no auth). This function
 * is JWT-scoped: a logged-in subcontractor sees every tender ever sent to
 * their own email address. Kept as a separate function deliberately —
 * tenderPublicApi's control flow is token-lookup-first, and bolting a
 * JWT-only action onto it would need a second pre-guard short-circuit.
 *
 * Auth: Authorization: Bearer <user JWT> required. No anon access.
 *
 * Actions:
 *   listMine — every tender_invitations row for the caller's own email,
 *              joined to its tender and (if any) its latest submission.
 *              Returns only the fields already exposed to a token holder via
 *              tenderPublicApi's `get` — never the raw tenders/submissions row.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_URL = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
// Reflect localhost origins for dev; otherwise lock to the app origin.
// (tenderPublicApi doesn't do this, which is why it can't be exercised from
// local dev — copied from registerInvited so this function can be.)
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
    const action = String(body?.action || '');

    // ── Auth: JWT required, no anon access ───────────────────────────────────
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authUser) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // AuthContext only blocks disabled users in the browser — a live JWT still
    // works against this function directly, so re-check here. A missing
    // public.users row (shouldn't happen, but auth.users can outlive it) is a
    // 403, not a 500.
    let profile: any;
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('disabled')
        .eq('id', authUser.id)
        .single();
      if (error || !data) throw error || new Error('no profile');
      profile = data;
    } catch (_e) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }
    if (profile.disabled === true) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders });
    }

    const email = normalizeEmail(authUser.email);

    // ── listMine ──────────────────────────────────────────────────────────────
    if (action === 'listMine') {
      if (!email) return Response.json({ tenders: [] }, { headers: corsHeaders });

      // users.email is GoTrue-normalised; invitee_email is whatever staff typed.
      // .ilike is a prefilter only — it treats `_` as a wildcard, which is a
      // legal email character, so re-verify exact match in JS below.
      const { data: invitationRows, error: invErr } = await supabaseAdmin
        .from('tender_invitations')
        .select('id, token, tender_id, invitee_email, status, sent_date')
        .ilike('invitee_email', email);
      if (invErr) throw new Error(`Could not read tender_invitations: ${invErr.message}`);

      const invitations = (invitationRows ?? []).filter(
        (inv: any) => normalizeEmail(inv.invitee_email) === email,
      );
      if (invitations.length === 0) {
        return Response.json({ tenders: [] }, { headers: corsHeaders });
      }

      const tenderIds = [...new Set(invitations.map((inv: any) => inv.tender_id))];
      const { data: tenderRows, error: tenderErr } = await supabaseAdmin
        .from('tenders')
        .select('id, tender_number, title, location, closing_date, ths_rft_closing_date, status')
        .in('id', tenderIds)
        .neq('status', 'Draft'); // withdrawn — issued then pulled back
      if (tenderErr) throw new Error(`Could not read tenders: ${tenderErr.message}`);
      const tendersById = new Map((tenderRows ?? []).map((t: any) => [t.id, t]));

      const invitationIds = invitations.map((inv: any) => inv.id);
      const { data: submissionRows, error: subErr } = await supabaseAdmin
        .from('tender_submissions')
        .select('invitation_id, submitted_at, lump_sum_price, outcome, outcome_notification_status')
        .in('invitation_id', invitationIds);
      if (subErr) throw new Error(`Could not read tender_submissions: ${subErr.message}`);

      // No unique constraint on submissions per invitation — take the latest by submitted_at.
      const latestSubmissionByInvitation = new Map<string, any>();
      for (const sub of submissionRows ?? []) {
        const existing = latestSubmissionByInvitation.get(sub.invitation_id);
        if (!existing || new Date(sub.submitted_at) > new Date(existing.submitted_at)) {
          latestSubmissionByInvitation.set(sub.invitation_id, sub);
        }
      }

      const results = invitations
        .filter((inv: any) => tendersById.has(inv.tender_id))
        .map((inv: any) => {
          const tender = tendersById.get(inv.tender_id);
          const submission = latestSubmissionByInvitation.get(inv.id);
          return {
            token: inv.token,
            tender_number: tender.tender_number,
            title: tender.title,
            location: tender.location,
            closing_date: tender.closing_date,
            ths_rft_closing_date: tender.ths_rft_closing_date,
            sent_date: inv.sent_date,
            invitation_status: inv.status,
            is_cancelled: tender.status === 'Cancelled',
            submitted_at: submission?.submitted_at ?? null,
            lump_sum_price: submission?.lump_sum_price ?? null,
            outcome: submission?.outcome_notification_status === 'Sent' ? submission.outcome : null,
          };
        });

      return Response.json({ tenders: results }, { headers: corsHeaders });
    }

    return Response.json({ error: 'Unknown action.' }, { status: 400, headers: corsHeaders });
  } catch (error: any) {
    console.error('[subcontractorPortal] ERROR:', error?.message);
    return Response.json({ error: error?.message || String(error) }, { status: 500, headers: corsHeaders });
  }
});
