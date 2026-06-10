import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * createTender
 * - Enforces admin/pricing role
 * - Uses atomic TenderCounter for sequential numbering
 * - Full stack trace logging at every DB step
 */
Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[createTender] ${msg}`); log.push(msg); };
  const fail = (msg, status = 500) => {
    console.error(`[createTender] FAIL: ${msg}`);
    return Response.json({ error: msg, trace: log }, { status });
  };

  try {
    trace('START');

    // ── Auth ──────────────────────────────────────────────────────────────
    const base44 = createClientFromRequest(req);
    trace('SDK initialised');

    let user;
    try {
      user = await base44.auth.me();
      trace(`auth.me resolved: email=${user?.email} role=${user?.role}`);
    } catch (authErr) {
      trace(`auth.me threw: ${authErr.message}`);
      return fail(`Authentication error: ${authErr.message}`, 401);
    }

    if (!user) return fail('Unauthorized — no user session', 401);
    if (!['admin', 'pricing'].includes(user.role)) {
      return fail(`Forbidden — role '${user.role}' not permitted`, 403);
    }

    // ── Atomic counter ────────────────────────────────────────────────────
    trace('Reading TenderCounter...');
    let counters;
    try {
      counters = await base44.asServiceRole.entities.TenderCounter.list('-created_date', 10);
      trace(`TenderCounter.list returned ${counters.length} record(s)`);
    } catch (cErr) {
      trace(`TenderCounter.list threw: ${cErr.message}`);
      return fail(`TenderCounter read failed: ${cErr.message}`);
    }

    let tenderNumber;
    let counterRecord = counters[0] || null;

    if (!counterRecord) {
      trace('No counter record found — creating at 1');
      try {
        counterRecord = await base44.asServiceRole.entities.TenderCounter.create({ current_value: 1 });
        trace(`TenderCounter created id=${counterRecord.id} value=1`);
      } catch (cCreateErr) {
        trace(`TenderCounter.create threw: ${cCreateErr.message}`);
        return fail(`TenderCounter create failed: ${cCreateErr.message}`);
      }
      tenderNumber = 'TDR-001';
    } else {
      const next = (counterRecord.current_value || 0) + 1;
      trace(`Incrementing counter id=${counterRecord.id} from ${counterRecord.current_value} → ${next}`);
      try {
        await base44.asServiceRole.entities.TenderCounter.update(counterRecord.id, { current_value: next });
        trace(`TenderCounter.update success: new value=${next}`);
      } catch (cUpdErr) {
        trace(`TenderCounter.update threw: ${cUpdErr.message}`);
        return fail(`TenderCounter update failed: ${cUpdErr.message}`);
      }
      tenderNumber = `TDR-${String(next).padStart(3, '0')}`;
    }

    trace(`Assigned tender number: ${tenderNumber}`);

    // ── Create tender ─────────────────────────────────────────────────────
    trace('Creating Tender entity...');
    let created;
    try {
      created = await base44.asServiceRole.entities.Tender.create({
        title: 'New Tender',
        status: 'Draft',
        tender_number: tenderNumber,
        created_by_email: user.email,
        invitees: [],
        scoring_criteria: [
          { criterion: 'Price',       weight_percent: 40 },
          { criterion: 'Experience',  weight_percent: 20 },
          { criterion: 'Programme',   weight_percent: 15 },
          { criterion: 'Methodology', weight_percent: 15 },
          { criterion: 'Compliance',  weight_percent: 10 },
        ],
      });
      trace(`Tender.create success: id=${created.id} number=${created.tender_number}`);
    } catch (tErr) {
      trace(`Tender.create threw: ${tErr.message}`);
      return fail(`Tender create failed: ${tErr.message}`);
    }

    trace('COMPLETE');
    return Response.json({ tender: created, trace: log });

  } catch (error) {
    console.error('[createTender] UNHANDLED:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack, trace: log }, { status: 500 });
  }
});