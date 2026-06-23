import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const LOCK_POLL_MS = 200;
const LOCK_MAX_WAIT = 12000;
const LOCK_TTL_MS = 15000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const log: string[] = [];
  const trace = (msg: string) => { console.log(`[createTender] ${msg}`); log.push(msg); };
  const fail = (msg: string, status = 500) => {
    console.error(`[createTender] FAIL: ${msg}`);
    return Response.json({ error: msg, trace: log }, { status, headers: corsHeaders });
  };

  let lockRecordId: string | null = null;

  try {
    trace('START');
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt);
    if (!authUser) return fail('Unauthorized', 401);

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', authUser.id).single();

    if (!profile) {
      await supabaseAdmin.from('users').upsert({ id: authUser.id, email: authUser.email, role: 'external' }, { onConflict: 'id' });
      return fail(`Profile was missing — please try again`, 503);
    }

    const user = { ...profile, id: authUser.id, email: authUser.email };

    if (!['admin', 'pricing'].includes(user.role)) return fail(`Forbidden — role '${user.role}'`, 403);
    trace(`auth: email=${user.email} role=${user.role}`);

    // Acquire lock via tender_counter table
    const lockId = crypto.randomUUID();
    trace(`Acquiring lock lockId=${lockId.slice(0, 8)}…`);
    const { data: lockRec } = await supabaseAdmin.from('tender_counter').insert({
      current_value: -1,
      lock_id: lockId,
      locked_at: new Date().toISOString(),
    }).select().single();
    if (lockRec) {
      lockRecordId = lockRec.id;
      trace(`Lock created id=${lockRecordId}`);
    }

    // Poll until we hold the lock
    if (lockRecordId) {
      const waitStart = Date.now();
      let held = false;
      while (!held && Date.now() - waitStart < LOCK_MAX_WAIT) {
        const { data: locks } = await supabaseAdmin.from('tender_counter').select('*').eq('current_value', -1);
        const allLocks = locks ?? [];
        for (const l of allLocks) {
          if (l.id !== lockRecordId && l.locked_at && Date.now() - new Date(l.locked_at).getTime() > LOCK_TTL_MS) {
            await supabaseAdmin.from('tender_counter').delete().eq('id', l.id);
            trace(`Expired stale lock id=${l.id}`);
          }
        }
        const active = allLocks.filter((l: any) => !l.locked_at || Date.now() - new Date(l.locked_at).getTime() <= LOCK_TTL_MS);
        const sorted = active.sort((a: any, b: any) => new Date(a.locked_at).getTime() - new Date(b.locked_at).getTime());
        if (sorted.length === 0 || sorted[0].id === lockRecordId) {
          held = true;
          trace(`Lock held after ${Date.now() - waitStart}ms`);
        } else {
          await new Promise(r => setTimeout(r, LOCK_POLL_MS));
        }
      }
      if (!held) trace('Lock wait timeout — proceeding anyway');
    }

    // Read + increment counter
    trace('Reading tender_counter…');
    const { data: allCounters } = await supabaseAdmin.from('tender_counter').select('*').order('created_at', { ascending: false }).limit(50);
    const counters = (allCounters ?? []).filter((c: any) => c.current_value !== -1);
    trace(`Counter records: ${counters.length}`);

    let tenderNumber: string;
    let counterRecord = counters[0] || null;

    if (!counterRecord) {
      trace('No counter — creating at 1');
      const { data: newCounter } = await supabaseAdmin.from('tender_counter').insert({ current_value: 1 }).select().single();
      counterRecord = newCounter;
      tenderNumber = 'TDR-001';
    } else {
      const next = (counterRecord.current_value || 0) + 1;
      trace(`Incrementing ${counterRecord.current_value} → ${next}`);
      await supabaseAdmin.from('tender_counter').update({ current_value: next }).eq('id', counterRecord.id);
      tenderNumber = `TDR-${String(next).padStart(3, '0')}`;
    }

    trace(`Tender number: ${tenderNumber}`);

    // Create tender
    const { data: created, error: createErr } = await supabaseAdmin.from('tenders').insert({
      title: 'New Tender',
      status: 'Draft',
      tender_number: tenderNumber,
      created_by_user_id: user.id,
      created_by_name: user.full_name || '',
      created_by_email: user.email,
      tender_lead_user_id: user.id,
      tender_lead_name: user.full_name || '',
      tender_lead_email: user.email,
      invitees: [],
      scoring_criteria: [
        { criterion: 'Price', weight_percent: 40 },
        { criterion: 'Experience', weight_percent: 20 },
        { criterion: 'Programme', weight_percent: 15 },
        { criterion: 'Methodology', weight_percent: 15 },
        { criterion: 'Compliance', weight_percent: 10 },
      ],
    }).select().single();

    if (createErr) return fail(`Tender create failed: ${createErr.message}`);
    trace(`Tender created id=${created.id} number=${created.tender_number}`);

    // Log activity (non-fatal)
    supabaseAdmin.from('tender_activity').insert({
      tender_id: created.id,
      event_type: 'tender_created',
      actor_name: user.full_name || user.email,
      actor_email: user.email,
      description: `Tender ${created.tender_number} created by ${user.full_name || user.email}`,
      occurred_at: new Date().toISOString(),
    }).then(null, () => {});

    trace('COMPLETE');
    return Response.json({ tender: created, trace: log }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[createTender] UNHANDLED:', error.message);
    return Response.json({ error: error.message, trace: log }, { status: 500, headers: corsHeaders });
  } finally {
    if (lockRecordId) {
      supabaseAdmin.from('tender_counter').delete().eq('id', lockRecordId).then(null, () => {});
    }
  }
});
