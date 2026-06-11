import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * createTender — Phase 2 (locking for atomic tender number generation)
 *
 * Lock protocol:
 *   1. Create a TenderCounterLock record with a unique lockId
 *   2. Re-read lock list — if our lock is the oldest, we hold the lock
 *   3. Read counter, increment, persist
 *   4. Create tender
 *   5. Release lock (delete lock record)
 *
 * Lock expires after 15s to handle crashes.
 */
Deno.serve(async (req) => {
  const log = [];
  const trace = (msg) => { console.log(`[createTender] ${msg}`); log.push(msg); };
  const fail = (msg, status = 500) => {
    console.error(`[createTender] FAIL: ${msg}`);
    return Response.json({ error: msg, trace: log }, { status });
  };

  const LOCK_TIMEOUT_MS = 15000;
  const LOCK_POLL_MS    = 200;
  const LOCK_MAX_WAIT   = 12000;
  let lockRecordId = null;

  try {
    trace('START');

    const base44 = createClientFromRequest(req);
    trace('SDK initialised');

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

    // ── Acquire lock ──────────────────────────────────────────────────────
    const lockId = crypto.randomUUID();
    const lockAcquiredAt = Date.now();
    trace(`Acquiring lock lockId=${lockId}`);

    let lockRecord;
    try {
      lockRecord = await base44.asServiceRole.entities.TenderCounter.create({
        current_value: -1,  // sentinel: -1 = lock record
        lock_id: lockId,
        locked_at: new Date().toISOString(),
      });
      lockRecordId = lockRecord.id;
      trace(`Lock record created id=${lockRecordId}`);
    } catch (e) {
      return fail(`Lock create failed: ${e.message}`);
    }

    // Wait until we hold the lock (we are the oldest -1 record)
    let lockHeld = false;
    const waitStart = Date.now();
    while (!lockHeld) {
      if (Date.now() - waitStart > LOCK_MAX_WAIT) {
        // Clean up expired locks and proceed anyway
        trace('Lock wait timeout — cleaning stale locks and proceeding');
        try {
          const allLocks = await base44.asServiceRole.entities.TenderCounter.filter({ current_value: -1 });
          const stale = allLocks.filter(l => {
            if (!l.locked_at) return true;
            return Date.now() - new Date(l.locked_at).getTime() > LOCK_TIMEOUT_MS;
          });
          for (const sl of stale) {
            if (sl.id !== lockRecordId) {
              await base44.asServiceRole.entities.TenderCounter.delete(sl.id).catch(() => {});
              trace(`Cleaned stale lock id=${sl.id}`);
            }
          }
        } catch (_) {}
        break;
      }

      try {
        const locks = await base44.asServiceRole.entities.TenderCounter.filter({ current_value: -1 });
        // Sort by created_date ascending — oldest holds the lock
        const sorted = locks
          .filter(l => l.locked_at)
          .sort((a, b) => new Date(a.locked_at) - new Date(b.locked_at));

        if (sorted.length === 0 || sorted[0].id === lockRecordId) {
          lockHeld = true;
          trace(`Lock acquired after ${Date.now() - lockAcquiredAt}ms`);
        } else {
          trace(`Waiting for lock — current holder id=${sorted[0].id}`);
          await new Promise(r => setTimeout(r, LOCK_POLL_MS));
        }
      } catch (e) {
        trace(`Lock poll error (continuing): ${e.message}`);
        break;
      }
    }

    // ── Read and increment counter ─────────────────────────────────────────
    trace('Reading TenderCounter...');
    let counters;
    try {
      // Filter out lock records (current_value === -1)
      const all = await base44.asServiceRole.entities.TenderCounter.list('-created_date', 50);
      counters = all.filter(c => c.current_value !== -1);
      trace(`TenderCounter records (non-lock): ${counters.length}`);
    } catch (e) {
      return fail(`TenderCounter read failed: ${e.message}`);
    }

    let tenderNumber;
    let counterRecord = counters[0] || null;

    if (!counterRecord) {
      trace('No counter found — creating at 1');
      try {
        counterRecord = await base44.asServiceRole.entities.TenderCounter.create({ current_value: 1 });
        trace(`Counter created id=${counterRecord.id} value=1`);
      } catch (e) {
        return fail(`Counter create failed: ${e.message}`);
      }
      tenderNumber = 'TDR-001';
    } else {
      const next = (counterRecord.current_value || 0) + 1;
      trace(`Incrementing counter id=${counterRecord.id}: ${counterRecord.current_value} → ${next}`);
      try {
        await base44.asServiceRole.entities.TenderCounter.update(counterRecord.id, { current_value: next });
        trace(`Counter updated to ${next}`);
      } catch (e) {
        return fail(`Counter update failed: ${e.message}`);
      }
      tenderNumber = `TDR-${String(next).padStart(3, '0')}`;
    }

    trace(`Tender number: ${tenderNumber}`);

    // ── Create tender ─────────────────────────────────────────────────────
    trace('Creating Tender...');
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
    // ── Release lock ───────────────────────────────────────────────────────
    if (lockRecordId) {
      try {
        await (async () => {
          const base44inner = createClientFromRequest(req);
          await base44inner.asServiceRole.entities.TenderCounter.delete(lockRecordId);
          console.log(`[createTender] Lock released id=${lockRecordId}`);
        })();
      } catch (e) {
        console.warn(`[createTender] Lock release failed (non-fatal): ${e.message}`);
      }
    }
  }
});