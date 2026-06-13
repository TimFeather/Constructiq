import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * createTender — atomic tender number via lock-then-increment.
 *
 * Lock protocol (all via asServiceRole):
 *   1. Create lock record (current_value = -1)
 *   2. Poll until our lock is the oldest active one
 *   3. Read + increment counter
 *   4. Create tender
 *   5. Delete lock record (finally block)
 */
Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[createTender] ${msg}`); log.push(msg); };
  const fail  = (msg, status = 500) => {
    console.error(`[createTender] FAIL: ${msg}`);
    return Response.json({ error: msg, trace: log }, { status });
  };

  const LOCK_POLL_MS  = 200;
  const LOCK_MAX_WAIT = 12000;
  const LOCK_TTL_MS   = 15000;
  let   lockRecordId  = null;
  let   sr            = null; // service-role client, set once

  try {
    trace('START');
    const base44 = createClientFromRequest(req);
    sr = base44.asServiceRole;
    trace('SDK initialised');

    // ── Auth ────────────────────────────────────────────────────────────
    let user;
    try {
      user = await base44.auth.me();
      trace(`auth.me: email=${user?.email} role=${user?.role}`);
    } catch (e) {
      return fail(`Auth error: ${e.message}`, 401);
    }
    if (!user) return fail('Unauthorized', 401);
    if (!['admin', 'pricing'].includes(user.role)) {
      return fail(`Forbidden — role '${user.role}' not permitted`, 403);
    }

    // ── Acquire lock ────────────────────────────────────────────────────
    const lockId = crypto.randomUUID();
    trace(`Acquiring lock lockId=${lockId.slice(0, 8)}…`);
    try {
      const lockRec = await sr.entities.TenderCounter.create({
        current_value: -1,
        lock_id:   lockId,
        locked_at: new Date().toISOString(),
      });
      lockRecordId = lockRec.id;
      trace(`Lock created id=${lockRecordId}`);
    } catch (e) {
      trace(`Lock create failed — proceeding without lock: ${e.message}`);
    }

    // Poll until we hold the lock (oldest -1 record)
    if (lockRecordId) {
      const waitStart = Date.now();
      let held = false;
      while (!held && Date.now() - waitStart < LOCK_MAX_WAIT) {
        try {
          const locks = await sr.entities.TenderCounter.filter({ current_value: -1 });
          // Expire stale locks
          for (const l of locks) {
            if (l.id !== lockRecordId && l.locked_at && Date.now() - new Date(l.locked_at).getTime() > LOCK_TTL_MS) {
              await sr.entities.TenderCounter.delete(l.id).catch(() => {});
              trace(`Expired stale lock id=${l.id}`);
            }
          }
          const active = locks.filter(l => !l.locked_at || Date.now() - new Date(l.locked_at).getTime() <= LOCK_TTL_MS);
          const sorted = active.sort((a, b) => new Date(a.locked_at) - new Date(b.locked_at));
          if (sorted.length === 0 || sorted[0].id === lockRecordId) {
            held = true;
            trace(`Lock held after ${Date.now() - waitStart}ms`);
          } else {
            await new Promise(r => setTimeout(r, LOCK_POLL_MS));
          }
        } catch (e) {
          trace(`Lock poll error (continuing): ${e.message}`);
          break;
        }
      }
      if (!held) trace('Lock wait timeout — proceeding anyway');
    }

    // ── Read + increment counter ────────────────────────────────────────
    trace('Reading TenderCounter…');
    let counters;
    try {
      const all = await sr.entities.TenderCounter.list('-created_date', 50);
      counters = all.filter(c => c.current_value !== -1);
      trace(`Counter records: ${counters.length}`);
    } catch (e) {
      return fail(`Counter read failed: ${e.message}`);
    }

    let tenderNumber;
    let counterRecord = counters[0] || null;

    if (!counterRecord) {
      trace('No counter — creating at 1');
      try {
        counterRecord = await sr.entities.TenderCounter.create({ current_value: 1 });
        trace(`Counter created id=${counterRecord.id}`);
      } catch (e) {
        return fail(`Counter create failed: ${e.message}`);
      }
      tenderNumber = 'TDR-001';
    } else {
      const next = (counterRecord.current_value || 0) + 1;
      trace(`Incrementing ${counterRecord.current_value} → ${next}`);
      try {
        await sr.entities.TenderCounter.update(counterRecord.id, { current_value: next });
        trace(`Counter updated to ${next}`);
      } catch (e) {
        return fail(`Counter update failed: ${e.message}`);
      }
      tenderNumber = `TDR-${String(next).padStart(3, '0')}`;
    }

    trace(`Tender number: ${tenderNumber}`);

    // ── Create tender ───────────────────────────────────────────────────
    trace('Creating Tender…');
    let created;
    try {
      created = await sr.entities.Tender.create({
        title:              'New Tender',
        status:             'Draft',
        tender_number:      tenderNumber,
        created_by_user_id: user.id,
        created_by_name:    user.full_name || '',
        created_by_email:   user.email,
        tender_lead_user_id: user.id,
        tender_lead_name:    user.full_name || '',
        tender_lead_email:   user.email,
        invitees:           [],
        scoring_criteria: [
          { criterion: 'Price',       weight_percent: 40 },
          { criterion: 'Experience',  weight_percent: 20 },
          { criterion: 'Programme',   weight_percent: 15 },
          { criterion: 'Methodology', weight_percent: 15 },
          { criterion: 'Compliance',  weight_percent: 10 },
        ],
      });
      trace(`Tender created id=${created.id} number=${created.tender_number}`);
    } catch (e) {
      return fail(`Tender create failed: ${e.message}`);
    }

    trace('COMPLETE');
    return Response.json({ tender: created, trace: log });

  } catch (error) {
    console.error('[createTender] UNHANDLED:', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack, trace: log }, { status: 500 });
  } finally {
    // Release lock
    if (lockRecordId && sr) {
      try {
        await sr.entities.TenderCounter.delete(lockRecordId);
        console.log(`[createTender] Lock released id=${lockRecordId}`);
      } catch (e) {
        console.warn(`[createTender] Lock release failed: ${e.message}`);
      }
    }
  }
});