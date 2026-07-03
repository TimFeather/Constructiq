/**
 * scheduleImportService.js
 *
 * Executes MSPDI imports against the database.
 *  - Fresh import: bulk-create tasks (persisting mspdi_uid), then link
 *    hierarchy and write dependencies as task_dependencies ROWS.
 *  - Update import: apply a computed diff (see scheduleImportDiff.js) —
 *    add new tasks, update changed ones, rebuild their dependency rows,
 *    write the audit trail. Tasks missing from the file are never touched.
 */

import { Task, TaskDependency, TaskChangeLog } from '@/api/entities';
import { supabase } from '@/api/supabaseClient';
import { retry429 } from '@/lib/retry429';

const CREATE_BATCH = 100;
const UPDATE_BATCH = 15;

/** Strip parser-internal fields down to a DB-insertable task row. */
function toDbRow(parsed) {
  const { _mspUid, _predecessorLinks, _parentUid, _outlineLevel, is_summary, constraint, predecessors, ...row } = parsed;
  return row;
}

/** Chunked bulk create with backoff; returns created rows in input order. */
async function bulkCreateTasks(rows, onProgress) {
  const created = [];
  for (let i = 0; i < rows.length; i += CREATE_BATCH) {
    const chunk = rows.slice(i, i + CREATE_BATCH);
    const result = await retry429(() => Task.bulkCreate(chunk));
    created.push(...result);
    onProgress?.(created.length, rows.length);
  }
  return created;
}

/** Chunked parallel updates. */
async function batchUpdateTasks(updates, onProgress) {
  let done = 0;
  for (let i = 0; i < updates.length; i += UPDATE_BATCH) {
    const batch = updates.slice(i, i + UPDATE_BATCH);
    await Promise.all(batch.map(({ id, ...payload }) =>
      retry429(() => Task.update(id, payload)).then(() => {
        done += 1;
        onProgress?.(done, updates.length);
      })
    ));
  }
}

/**
 * Build task_dependencies rows for a set of parsed tasks whose UIDs have
 * been resolved to DB ids.
 */
function buildDependencyRows(parsedTasks, uidToDbId, projectId) {
  const rows = [];
  for (const pt of parsedTasks) {
    const succId = uidToDbId.get(Number(pt.mspdi_uid));
    if (!succId) continue;
    for (const link of (pt._predecessorLinks || [])) {
      const predId = uidToDbId.get(Number(link._predUid));
      if (!predId || predId === succId) continue;
      rows.push({
        project_id: projectId,
        predecessor_task_id: predId,
        successor_task_id: succId,
        type: link.type || 'FS',
        lag_days: Math.round(((link.lag_hours || 0) / 8) * 100) / 100,
        is_elapsed: !!link.is_elapsed,
      });
    }
  }
  return rows;
}

async function insertDependencyRows(rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += CREATE_BATCH) {
    await retry429(() => TaskDependency.bulkCreate(rows.slice(i, i + CREATE_BATCH)));
  }
}

/**
 * Fresh import: create everything.
 *
 * @param {Array} parsedTasks - output of parseXML/parseMPX/parseExcelCSV
 * @param {string} projectId
 * @param {Function} onStage - (stageIdx, pct, detail) progress callback
 * @returns {number} created task count
 */
export async function executeFreshImport(parsedTasks, projectId, onStage) {
  // Stage: create tasks (mspdi_uid persists on the row)
  onStage?.(2, 30, `Creating ${parsedTasks.length} tasks`);
  const created = await bulkCreateTasks(parsedTasks.map(toDbRow), (done, total) => {
    onStage?.(2, 30 + Math.round((done / total) * 25), `${done} / ${total} tasks created`);
  });

  const uidToDbId = new Map();
  parsedTasks.forEach((pt, i) => {
    if (pt.mspdi_uid != null && created[i]?.id) uidToDbId.set(Number(pt.mspdi_uid), created[i].id);
  });

  // Stage: hierarchy (parent_id) via batched updates
  onStage?.(3, 60, 'Linking hierarchy');
  const parentUpdates = [];
  parsedTasks.forEach((pt, i) => {
    const dbId = created[i]?.id;
    if (!dbId || pt._parentUid == null) return;
    const parentDbId = uidToDbId.get(Number(pt._parentUid));
    if (parentDbId) parentUpdates.push({ id: dbId, parent_id: parentDbId });
  });
  await batchUpdateTasks(parentUpdates, (done, total) => {
    onStage?.(3, 60 + Math.round((done / total) * 15), `${done} / ${total} hierarchy links`);
  });

  // Stage: dependencies as normalized rows (bulk insert)
  onStage?.(4, 80, 'Writing dependencies');
  await insertDependencyRows(buildDependencyRows(parsedTasks, uidToDbId, projectId));

  onStage?.(5, 95, 'Finalising');
  return created.length;
}

/**
 * Update import: apply a diff (never deletes; missing tasks only flagged).
 *
 * @param {Object} diff - from computeImportDiff
 * @param {string} projectId
 * @param {Array} existingTasks - current programme tasks
 * @param {string|null} userId - for the audit trail
 * @param {Function} onStage
 * @returns {{ createdCount, updatedCount }}
 */
export async function executeUpdateImport(diff, projectId, existingTasks, userId, onStage) {
  // UID → DB id map seeded with the existing tasks
  const uidToDbId = new Map(
    existingTasks.filter(t => t.mspdi_uid != null).map(t => [Number(t.mspdi_uid), t.id])
  );

  // 1. Create added tasks
  onStage?.(2, 30, `Creating ${diff.added.length} new tasks`);
  const created = diff.added.length
    ? await bulkCreateTasks(diff.added.map(toDbRow))
    : [];
  diff.added.forEach((pt, i) => {
    if (pt.mspdi_uid != null && created[i]?.id) uidToDbId.set(Number(pt.mspdi_uid), created[i].id);
  });

  // 2. Update changed tasks (only the diffed scalar fields + constraint)
  onStage?.(3, 45, `Updating ${diff.changed.length} changed tasks`);
  const changeLogRows = [];
  const taskUpdates = [];
  for (const { existing, incoming, fieldDiffs } of diff.changed) {
    const payload = {};
    for (const d of fieldDiffs) {
      if (d.field === 'parent' || d.field === 'predecessors') continue; // handled below
      if (d.field === 'constraint_data') payload.constraint_data = incoming.constraint_data || null;
      else payload[d.field] = incoming[d.field] ?? null;

      changeLogRows.push({
        task_id: existing.id,
        project_id: projectId,
        field_changed: d.field,
        old_value: d.from == null ? null : (typeof d.from === 'object' ? JSON.stringify(d.from) : String(d.from)),
        new_value: d.to == null ? null : (typeof d.to === 'object' ? JSON.stringify(d.to) : String(d.to)),
        changed_by: userId || null,
        trigger_task_id: null,
      });
    }
    if (Object.keys(payload).length) taskUpdates.push({ id: existing.id, ...payload });
  }
  await batchUpdateTasks(taskUpdates, (done, total) => {
    onStage?.(3, 45 + Math.round((done / total) * 20), `${done} / ${total} tasks updated`);
  });

  // 3. Parent moves (uid space → db ids)
  const parentUpdates = [];
  for (const { existing, incoming, fieldDiffs } of diff.changed) {
    if (!fieldDiffs.some(d => d.field === 'parent')) continue;
    const parentDbId = incoming._parentUid != null ? (uidToDbId.get(Number(incoming._parentUid)) || null) : null;
    parentUpdates.push({ id: existing.id, parent_id: parentDbId });
  }
  await batchUpdateTasks(parentUpdates);

  // 4. Rebuild dependency rows for added tasks + tasks whose deps changed
  onStage?.(4, 75, 'Rebuilding dependencies');
  const depChangedIds = diff.changed
    .filter(c => c.fieldDiffs.some(d => d.field === 'predecessors'))
    .map(c => c.existing.id);
  if (depChangedIds.length) {
    const { error } = await supabase
      .from('task_dependencies')
      .delete()
      .in('successor_task_id', depChangedIds);
    if (error) throw error;
  }
  const depSources = [
    ...diff.added,
    ...diff.changed.filter(c => c.fieldDiffs.some(d => d.field === 'predecessors')).map(c => ({
      ...c.incoming,
    })),
  ];
  await insertDependencyRows(buildDependencyRows(depSources, uidToDbId, projectId));

  // 5. Audit trail (best effort)
  if (changeLogRows.length) {
    try {
      await TaskChangeLog.bulkCreate(changeLogRows);
    } catch (err) {
      console.warn('import change-log write failed:', err.message);
    }
  }

  onStage?.(5, 95, 'Finalising');
  return { createdCount: created.length, updatedCount: diff.changed.length };
}
