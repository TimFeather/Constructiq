/**
 * scheduleImportDiff.js
 *
 * Pure diff between a parsed MSPDI file and the tasks already in a
 * ConstructIQ programme, matched by mspdi_uid. Drives the update-vs-append
 * re-import flow: never blind-overwrite, never blind-append, and tasks
 * missing from the new file are FLAGGED, not deleted.
 */

/** Fields compared for change detection (simple scalar fields). */
const SCALAR_FIELDS = ['name', 'wbs', 'start_date', 'end_date', 'duration', 'percent_complete'];

function normalizeConstraint(c) {
  if (!c || !c.type || c.type === 'ASAP') return null;
  return `${c.type}:${c.date || ''}`;
}

/**
 * Serialize a task's dependency set as a comparable string of
 * predecessor mspdi_uids: "3:FS:0|7:SS:16".
 *
 * @param links - [{ _predUid, type, lag_hours }] for parsed tasks, or
 *                existing predecessors mapped to uids by the caller
 */
function depKey(links) {
  return (links || [])
    .map(l => `${l._predUid}:${l.type || 'FS'}:${Math.round((l.lag_hours || 0) * 100) / 100}`)
    .sort()
    .join('|');
}

/**
 * Compute the import diff.
 *
 * @param {Array} parsedTasks   - output of parseXML (with mspdi_uid, _predecessorLinks, _parentUid)
 * @param {Array} existingTasks - current programme tasks (engine shape: predecessors attached)
 * @returns {{ added, changed, missing, unchangedCount, unmatchedExisting }}
 */
export function computeImportDiff(parsedTasks, existingTasks) {
  const existingByUid = new Map();
  const unmatchedExisting = [];
  for (const t of existingTasks) {
    if (t.mspdi_uid != null) existingByUid.set(Number(t.mspdi_uid), t);
    else unmatchedExisting.push(t);
  }

  // DB id → mspdi_uid, to express existing dependencies in file terms
  const dbIdToUid = new Map(
    existingTasks.filter(t => t.mspdi_uid != null).map(t => [t.id, Number(t.mspdi_uid)])
  );

  const parsedUids = new Set(parsedTasks.map(t => Number(t.mspdi_uid)));

  const added = [];
  const changed = [];
  let unchangedCount = 0;

  for (const incoming of parsedTasks) {
    const existing = existingByUid.get(Number(incoming.mspdi_uid));
    if (!existing) {
      added.push(incoming);
      continue;
    }

    const fieldDiffs = [];
    for (const field of SCALAR_FIELDS) {
      const from = existing[field] ?? null;
      const to = incoming[field] ?? null;
      // numeric-tolerant comparison (duration '5' vs 5)
      const same = from === to
        || (from != null && to != null && !isNaN(from) && !isNaN(to) && Number(from) === Number(to));
      if (!same) fieldDiffs.push({ field, from, to });
    }

    // Constraint
    const fromC = normalizeConstraint(existing.constraint_data || existing.constraint);
    const toC = normalizeConstraint(incoming.constraint_data);
    if (fromC !== toC) {
      fieldDiffs.push({
        field: 'constraint_data',
        from: existing.constraint_data || existing.constraint || null,
        to: incoming.constraint_data || null,
      });
    }

    // Parent (compare in uid space)
    const fromParentUid = existing.parent_id != null ? (dbIdToUid.get(existing.parent_id) ?? '?') : null;
    const toParentUid = incoming._parentUid ?? null;
    if (String(fromParentUid ?? '') !== String(toParentUid ?? '')) {
      fieldDiffs.push({ field: 'parent', from: fromParentUid, to: toParentUid });
    }

    // Dependencies (compare in uid space)
    const existingLinks = (existing.predecessors || [])
      .map(p => {
        const uid = dbIdToUid.get(p.predecessor_id || p.task_id);
        if (uid == null) return null;
        return { _predUid: uid, type: p.type, lag_hours: p.lag_hours ?? (p.lag_days ?? 0) * 8 };
      })
      .filter(Boolean);
    if (depKey(existingLinks) !== depKey(incoming._predecessorLinks)) {
      fieldDiffs.push({
        field: 'predecessors',
        from: depKey(existingLinks) || null,
        to: depKey(incoming._predecessorLinks) || null,
      });
    }

    if (fieldDiffs.length) changed.push({ existing, incoming, fieldDiffs });
    else unchangedCount += 1;
  }

  const missing = existingTasks.filter(
    t => t.mspdi_uid != null && !parsedUids.has(Number(t.mspdi_uid))
  );

  return { added, changed, missing, unchangedCount, unmatchedExisting };
}

/**
 * Should this import use the update flow?
 * True when the target programme already has tasks carrying mspdi_uids.
 */
export function isUpdateImport(existingTasks) {
  return existingTasks.some(t => t.mspdi_uid != null);
}
