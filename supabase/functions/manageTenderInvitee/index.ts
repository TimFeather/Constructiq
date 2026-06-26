/**
 * manageTenderInvitee
 *
 * Manages TenderInvitee records (the per-tender invitee list).
 * Also upserts TenderContact (master directory) on create.
 *
 * Actions:
 *   create  – add invitee to tender + upsert tender_contacts
 *   delete  – remove invitee from tender
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function getUserClient(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const log: string[] = [];
  const trace = (msg: string) => { console.log(`[manageTenderInvitee] ${msg}`); log.push(msg); };
  const fail = (msg: string, status = 500) => {
    console.error(`[manageTenderInvitee] FAIL: ${msg}`);
    return Response.json({ error: msg, trace: log }, { status, headers: corsHeaders });
  };

  try {
    trace('START');

    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !authUser) return fail('Unauthorized', 401);

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();
    const user: any = { ...profile, id: authUser.id, email: authUser.email };

    trace(`auth: email=${user?.email} role=${user?.role}`);

    if (!['admin', 'pricing', 'internal'].includes(user.role)) {
      return fail(`Forbidden — role '${user.role}'`, 403);
    }

    let body: any;
    try { body = await req.json(); }
    catch (e: any) { return fail(`Invalid body: ${e.message}`, 400); }

    const { action } = body;
    if (!action) return fail('action is required', 400);

    // ── CREATE ────────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { tenderId, fullName, businessName, email, phone, trade } = body;
      if (!tenderId) return fail('tenderId is required', 400);
      if (!fullName)  return fail('fullName is required', 400);

      trace(`CREATE invitee tender=${tenderId} email=${email}`);

      // Duplicate email check
      if (email) {
        const { data: existingRows } = await supabaseAdmin
          .from('tender_invitees')
          .select('*')
          .eq('tender_id', tenderId);
        const dup = (existingRows ?? []).find((i: any) => i.email?.toLowerCase() === email.toLowerCase());
        if (dup) {
          trace(`Duplicate email ${email} — returning existing id=${dup.id}`);
          return Response.json({ success: true, invitee: dup, trace: log }, { headers: corsHeaders });
        }
      }

      // Upsert tender_contacts
      let contactId: string | null = null;
      try {
        const { data: contactRows } = await supabaseAdmin
          .from('tender_contacts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1000);
        const contacts: any[] = contactRows ?? [];
        const emailLower = email?.toLowerCase();
        let contact = emailLower
          ? contacts.find((c: any) => c.email?.toLowerCase() === emailLower)
          : contacts.find((c: any) =>
              c.full_name?.toLowerCase() === fullName.toLowerCase() &&
              c.business_name?.toLowerCase() === (businessName || '').toLowerCase()
            );

        if (contact) {
          await supabaseAdmin.from('tender_contacts').update({
            full_name:     fullName,
            business_name: businessName || contact.business_name || '',
            phone:         phone        || contact.phone         || '',
            trade:         trade        || contact.trade         || '',
          }).eq('id', contact.id);
          contactId = contact.id;
          trace(`TenderContact UPDATED id=${contact.id}`);
        } else {
          const { data: created } = await supabaseAdmin
            .from('tender_contacts')
            .insert({
              full_name:     fullName,
              business_name: businessName || '',
              email:         email        || '',
              phone:         phone        || '',
              trade:         trade        || '',
            })
            .select()
            .single();
          contactId = created?.id ?? null;
          trace(`TenderContact CREATED id=${created?.id}`);
        }
      } catch (e: any) {
        trace(`TenderContact upsert failed (non-fatal): ${e.message}`);
      }

      // Create TenderInvitee
      trace('BEFORE_CREATE');
      const { data: invitee, error: createError } = await supabaseAdmin
        .from('tender_invitees')
        .insert({
          tender_id:     tenderId,
          contact_id:    contactId,
          full_name:     fullName,
          business_name: businessName || '',
          email:         email        || '',
          phone:         phone        || '',
          trade:         trade        || '',
          status:        'Draft',
        })
        .select()
        .single();
      if (createError) return fail(`Insert failed: ${createError.message}`, 500);
      trace(`AFTER_CREATE id=${invitee?.id}`);

      // ── Verify-after-write ────────────────────────────────────────────────────
      let verifyGet: any = null;
      let verifyGetError: string | null = null;
      try {
        const { data, error } = await supabaseAdmin
          .from('tender_invitees')
          .select('*')
          .eq('id', invitee?.id)
          .single();
        verifyGet = data;
        if (error) verifyGetError = error.message;
        trace(`AFTER_VERIFY_GET exists=${!!verifyGet} id=${verifyGet?.id ?? 'null'}`);
      } catch (e: any) {
        verifyGetError = e.message;
        trace(`AFTER_VERIFY_GET error=${e.message}`);
      }

      let verifyFilter: any[] = [];
      let verifyFilterError: string | null = null;
      try {
        const { data, error } = await supabaseAdmin
          .from('tender_invitees')
          .select('*')
          .eq('tender_id', tenderId);
        verifyFilter = data ?? [];
        if (error) verifyFilterError = error.message;
        trace(`AFTER_VERIFY_FILTER_TENDER count=${verifyFilter.length} ids=${verifyFilter.map((x: any) => x.id).join(',')}`);
      } catch (e: any) {
        verifyFilterError = e.message;
        trace(`AFTER_VERIFY_FILTER_TENDER error=${e.message}`);
      }

      let verifyEmail: any[] = [];
      let verifyEmailError: string | null = null;
      if (email) {
        try {
          const { data, error } = await supabaseAdmin
            .from('tender_invitees')
            .select('*')
            .eq('email', email);
          verifyEmail = data ?? [];
          if (error) verifyEmailError = error.message;
          trace(`AFTER_VERIFY_FILTER_EMAIL count=${verifyEmail.length} ids=${verifyEmail.map((x: any) => x.id).join(',')}`);
        } catch (e: any) {
          verifyEmailError = e.message;
          trace(`AFTER_VERIFY_FILTER_EMAIL error=${e.message}`);
        }
      }

      return Response.json({
        success: true,
        invitee,
        verify: {
          get:               verifyGet,
          getError:          verifyGetError,
          filterTender:      verifyFilter,
          filterTenderError: verifyFilterError,
          filterEmail:       verifyEmail,
          filterEmailError:  verifyEmailError,
        },
        trace: log,
      }, { headers: corsHeaders });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { inviteeId } = body;
      if (!inviteeId) return fail('inviteeId is required', 400);
      trace(`DELETE TenderInvitee id=${inviteeId}`);

      // Must delete invitations first (FK: tender_invitations.invitee_id → tender_invitees.id)
      const { error: invErr } = await supabaseAdmin
        .from('tender_invitations')
        .delete()
        .eq('invitee_id', inviteeId);
      if (invErr) trace(`Warning: invitation delete error: ${invErr.message}`);

      // Also remove any submissions linked to this invitee
      const { error: subErr } = await supabaseAdmin
        .from('tender_submissions')
        .delete()
        .eq('invitee_id', inviteeId);
      if (subErr) trace(`Warning: submission delete error: ${subErr.message}`);

      const { error: delErr } = await supabaseAdmin
        .from('tender_invitees')
        .delete()
        .eq('id', inviteeId);
      if (delErr) return fail(`Delete failed: ${delErr.message}`, 500);

      trace(`Deleted invitee id=${inviteeId}`);
      return Response.json({ success: true, trace: log }, { headers: corsHeaders });
    }

    return fail(`Unknown action: ${action}`, 400);

  } catch (error: any) {
    console.error('[manageTenderInvitee] UNHANDLED:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack, trace: log }, { status: 500, headers: corsHeaders });
  }
});
