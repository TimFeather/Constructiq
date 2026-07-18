/**
 * ScheduleUpdateService — Single Source of Truth for all schedule mutations.
 *
 * ALL task edits that affect scheduling MUST go through this service.
 * No component may call Task.update() directly for
 * date/duration/dependency/constraint/progress changes.
 *
 * Pipeline for every mutation:
 *   1. Merge the change into the in-memory task list
 *   2. Run the full schedule engine (CPM + rollup) with the project calendar
 *   3. Compute all patches (every task whose dates/duration changed)
 *   4. Persist: the edited task directly, the cascade in ONE bulk round trip
 *   5. Write the audit trail (task_change_log): the direct edit rows carry
 *      changed_by; engine-cascaded rows carry changed_by = null and
 *      trigger_task_id = the task whose edit kicked off the recalc — this is
 *      how a PM answers "why did this task move" months later
 *   6. Return the updated task list and scheduled map for UI refresh
 */

import { runScheduleEngine, wouldCreateCycle } from './scheduling/scheduleEngine.js';
import { validateLink } from './scheduling/dependencyGraph.js';
import { validateCalendar } from './scheduling/calendarEngine.js';
import { Task, TaskChangeLog } from '@/api/entities';
import { bulkUpdateSchedule, setTaskDependencies } from '@/api/programmeData';

/** Fields whose changes are recorded in the audit trail. */
const LOGGED_FIELDS = [
  'start_date', 'end_date', 'duration', 'percent_complete',
  'actual_start', 'actual_finish', 'constraint', 'predecessors',
  'name', 'assignee_email',
];

function serialize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Build change-log rows for the directly edited task. */
function directChangeRows(task, changes, userId) {
  const rows = [];
  for (const field of LOGGED_FIELDS) {
    if (!(field in changes)) continue;
    const oldVal = serialize(task[field]);
    const newVal = serialize(changes[field]);
    if (oldVal === newVal) continue;
    rows.push({
      task_id: task.id,
      project_id: task.project_id,
      field_changed: field,
      old_value: oldVal,
      new_value: newVal,
      changed_by: userId || null,
      trigger_task_id: null,
    });
  }
  return rows;
}

/** Build change-log rows for engine-cascaded date shifts. */
function cascadeChangeRows(patches, taskMap, triggerTaskId) {
  const rows = [];
  for (const p of patches) {
    if (p.id === triggerTaskId) continue;
    const task = taskMap.get(p.id);
    if (!task) continue;
    for (const field of ['start_date', 'end_date']) {
      if (serialize(task[field]) === serialize(p[field])) continue;
      rows.push({
        task_id: p.id,
        project_id: task.project_id,
        field_changed: field,
        old_value: serialize(task[field]),
        new_value: serialize(p[field]),
        changed_by: null,             // system-cascaded
        trigger_task_id: triggerTaskId,
      });
    }
  }
  return rows;
}

/** Best-effort audit write — a log failure must never break the schedule save. */
async function writeChangeLog(rows) {
  if (!rows.length) return;
  try {
    await TaskChangeLog.bulkCreate(rows);
  } catch (err) {
    console.warn('task_change_log write failed (schedule save unaffected):', err.message);
  }
}

/**
 * Map service-level changes onto DB columns for the direct task update.
 * - `constraint` is an engine-side alias for the constraint_data column
 * - `predecessors` is persisted to task_dependencies rows, not the tasks table
 */
function toDbPayload(changes) {
  const payload = { ...changes };
  if ('constraint' in payload) {
    payload.constraint_data = payload.constraint;
    delete payload.constraint;
  }
  delete payload.predecessors;
  return payload;
}

/**
 * Core update pipeline.
 * Merges `changes` into `allTasks`, runs the engine, persists all patches.
 *
 * @param {string} taskId   - The task being directly edited
 * @param {Object} changes  - Fields being changed on that task (engine-shape:
 *                            may include `constraint` and `predecessors`)
 * @param {Array}  allTasks - Full current task list (engine-shape, from
 *                            fetchProgrammeTasks)
 * @param {Object} [options]
 *   userId       - auth user id for the audit trail
 *   projectStart - fallback anchor date (yyyy-MM-dd)
 *   calendar     - working calendar (from calendarForProgramme)
 *   dataDate     - programme data date (yyyy-MM-dd or null)
 *   criticalToleranceDays - flag tasks critical when float ≤ this many days
 * @returns {Promise<{ patches: Array, scheduledMap: Map, mergedTasks: Array }>}
 */
export async function applyScheduleUpdate(taskId, changes, allTasks, options = {}) {
  const { userId = null, projectStart, calendar, dataDate, criticalToleranceDays = 0 } = options;
  const task = allTasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  // 1. Merge change into task list
  const mergedTasks = allTasks.map(t =>
    t.id === taskId ? { ...t, ...changes } : t
  );
  const taskMap = new Map(allTasks.map(t => [t.id, t]));

  // 2. Run full schedule engine
  const scheduledMap = runScheduleEngine(mergedTasks, projectStart, calendar, { dataDate, criticalToleranceDays });

  // 3. Compute all patches — every task whose stored dates differ from computed
  const patches = [];
  for (const t of mergedTasks) {
    const resolved = scheduledMap.get(t.id);
    if (!resolved) continue;
    const hasDateChange = resolved.startStr !== t.start_date || resolved.finishStr !== t.end_date;
    const hasDurChange = resolved.durationDays !== t.duration;
    if (hasDateChange || hasDurChange) {
      patches.push({
        id: t.id,
        start_date: resolved.startStr,
        end_date: resolved.finishStr,
        duration: resolved.durationDays,
      });
    }
  }

  // 4. Persist the direct edit (all its fields + any engine-resolved dates)
  const directPatch = patches.find(p => p.id === taskId);
  const directChanges = directPatch
    ? { ...changes, start_date: directPatch.start_date, end_date: directPatch.end_date, duration: directPatch.duration }
    : { ...changes };

  if ('predecessors' in changes) {
    await setTaskDependencies(taskId, task.project_id, changes.predecessors);
  }
  const dbPayload = toDbPayload(directChanges);
  if (Object.keys(dbPayload).length) {
    await Task.update(taskId, dbPayload);
  }

  // 5. Persist the cascade in one bulk round trip
  const cascadePatches = patches.filter(p => p.id !== taskId);
  if (cascadePatches.length) {
    await bulkUpdateSchedule(cascadePatches);
  }

  // 6. Audit trail
  await writeChangeLog([
    ...directChangeRows(task, directChanges, userId),
    ...cascadeChangeRows(patches, taskMap, taskId),
  ]);

  return { patches, scheduledMap, mergedTasks };
}

/**
 * Update a task's duration and cascade all successors.
 */
export async function updateTaskDuration(taskId, newDuration, allTasks, options) {
  return applyScheduleUpdate(
    taskId,
    { duration: Math.max(1, newDuration) },
    allTasks,
    options
  );
}

/**
 * Update a task's start date and cascade all successors.
 * Setting a start date directly = user intent that the task not start
 * before that date, so it becomes an SNET constraint.
 */
export async function updateTaskStartDate(taskId, newStartDate, allTasks, options) {
  const changes = {
    start_date: newStartDate,
    constraint: { type: 'SNET', date: newStartDate },
  };
  return applyScheduleUpdate(taskId, changes, allTasks, options);
}

/**
 * Update a task's dependencies/predecessors and cascade.
 * Rejects (throws) any link that would create a circular dependency.
 */
export async function updateTaskDependency(taskId, predecessors, allTasks, options) {
  const tasksWithNewDep = allTasks.map(t =>
    t.id === taskId ? { ...t, predecessors } : t
  );
  const taskName = allTasks.find(t => t.id === taskId)?.name || taskId;

  for (const pred of predecessors) {
    const pid = pred.predecessor_id || pred.task_id;
    const existingPredecessors = predecessors.filter(p => p !== pred);
    const result = validateLink(tasksWithNewDep, pid, taskId, existingPredecessors);
    if (result.ok) continue;

    const predName = allTasks.find(t => t.id === pid)?.name || pid;
    switch (result.reason) {
      case 'self':
        throw new Error('A task cannot depend on itself.');
      case 'missing-task':
        throw new Error('Predecessor task not found.');
      case 'link-to-ancestor':
        throw new Error(`"${predName}" is a summary task that contains "${taskName}" — a task cannot depend on its own summary.`);
      case 'link-to-descendant':
        throw new Error(`"${predName}" is inside "${taskName}" — a summary cannot depend on its own subtask.`);
      case 'duplicate':
        throw new Error(`"${taskName}" is already linked to "${predName}".`);
      case 'cycle':
        throw new Error(`Circular dependency: "${taskName}" already leads to "${predName}" — this link would create a loop.`);
      default:
        throw new Error('Invalid dependency link.');
    }
  }

  return applyScheduleUpdate(taskId, { predecessors }, allTasks, options);
}

/**
 * Update a task's scheduling constraint and cascade.
 */
export async function updateTaskConstraint(taskId, constraint, allTasks, options) {
  return applyScheduleUpdate(taskId, { constraint }, allTasks, options);
}

/**
 * Update percent complete and actual dates.
 *
 * Pure percent bumps don't move other tasks (fast path: direct save).
 * But a REAL SLIP — an actual start/finish that differs from the planned
 * date — reruns the engine so late-finishing predecessors push their
 * successors (and early finishes pull them in).
 */
export async function updateTaskProgress(taskId, percent_complete, allTasks, options = {}) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const changes = { percent_complete };
  if (percent_complete > 0 && !task.actual_start) {
    // Backfill: assume the task started as planned (progress is usually
    // logged mid-task, not the moment work began). Only use today when the
    // planned start hasn't arrived yet (work genuinely started early).
    changes.actual_start = task.start_date && task.start_date <= todayStr
      ? task.start_date
      : todayStr;
  }
  if (percent_complete >= 100 && !task.actual_finish) {
    changes.actual_finish = todayStr;
  }
  if (percent_complete < 100 && task.actual_finish) {
    changes.actual_finish = null; // un-completing a task clears its finish
  }

  const finishSlipped = percent_complete >= 100
    && (changes.actual_finish || task.actual_finish)
    && (changes.actual_finish || task.actual_finish) !== task.end_date;
  const startSlipped = changes.actual_start && changes.actual_start !== task.start_date;
  // Un-completing clears actual_finish, which unpins the task — its computed
  // finish (and every successor) can move, so the cascade must run.
  const uncompleted = 'actual_finish' in changes && changes.actual_finish === null;

  if (finishSlipped || startSlipped || uncompleted) {
    // Real slip (or early finish): cascade through the network
    return applyScheduleUpdate(taskId, changes, allTasks, options);
  }

  // Fast path — no cascade, but log the progress change
  await Task.update(taskId, changes);
  await writeChangeLog(directChangeRows(task, changes, options.userId));

  const mergedTasks = allTasks.map(t => (t.id === taskId ? { ...t, ...changes } : t));
  const scheduledMap = runScheduleEngine(mergedTasks, options.projectStart, options.calendar, { dataDate: options.dataDate, criticalToleranceDays: options.criticalToleranceDays || 0 });
  return { patches: [], scheduledMap, mergedTasks };
}

/**
 * Full task save (from the editor panel) — handles all field types.
 * Detects which scheduling-relevant fields changed and runs cascade.
 */
export async function updateTaskFull(taskId, newData, allTasks, options = {}) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const scheduleFields = ['start_date', 'end_date', 'duration', 'predecessors', 'constraint', 'percent_complete', 'actual_start', 'actual_finish'];
  const hasScheduleChange = scheduleFields.some(f => {
    if (!(f in newData)) return false;
    return JSON.stringify(task[f] ?? null) !== JSON.stringify(newData[f] ?? null);
  });

  if (hasScheduleChange) {
    return applyScheduleUpdate(taskId, newData, allTasks, options);
  }

  // Only non-scheduling fields changed — direct save, no cascade
  await Task.update(taskId, toDbPayload(newData));
  await writeChangeLog(directChangeRows(task, newData, options.userId));
  const mergedTasks = allTasks.map(t => (t.id === taskId ? { ...t, ...newData } : t));
  const scheduledMap = runScheduleEngine(mergedTasks, options.projectStart, options.calendar, { dataDate: options.dataDate, criticalToleranceDays: options.criticalToleranceDays || 0 });
  return { patches: [], scheduledMap, mergedTasks };
}

/**
 * Validate schedule integrity across a task list.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateScheduleIntegrity(tasks, calendar) {
  const errors = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  if (calendar) {
    for (const problem of validateCalendar(calendar)) {
      errors.push(problem);
    }
  }

  for (const task of tasks) {
    // Negative or zero duration (non-milestone)
    if (!task.is_milestone && task.duration !== 0 && task.duration < 1) {
      errors.push(`Task "${task.name}" has invalid duration: ${task.duration}`);
    }

    // Invalid date range
    if (task.start_date && task.end_date && task.start_date > task.end_date) {
      errors.push(`Task "${task.name}" has start after end: ${task.start_date} > ${task.end_date}`);
    }

    // Missing predecessors
    for (const pred of (task.predecessors || [])) {
      const pid = pred.predecessor_id || pred.task_id;
      if (pid && !taskMap.has(pid)) {
        errors.push(`Task "${task.name}" references missing predecessor ID: ${pid}`);
      }
    }

    // Circular dependency check
    for (const pred of (task.predecessors || [])) {
      const pid = pred.predecessor_id || pred.task_id;
      if (!pid) continue;
      if (wouldCreateCycle(tasks, pid, task.id)) {
        errors.push(`Circular dependency detected involving task "${task.name}"`);
        break;
      }
    }

    // Hierarchy-aware link checks (ancestor/descendant links, duplicates)
    const taskPreds = task.predecessors || [];
    for (const pred of taskPreds) {
      const pid = pred.predecessor_id || pred.task_id;
      if (!pid || !taskMap.has(pid)) continue;
      const existingPredecessors = taskPreds.filter(p => p !== pred);
      const result = validateLink(tasks, pid, task.id, existingPredecessors);
      if (result.ok) continue;
      const predName = taskMap.get(pid)?.name || pid;
      if (result.reason === 'link-to-ancestor' || result.reason === 'link-to-descendant') {
        errors.push(`Task "${task.name}" is linked to its own summary/subtask "${predName}"`);
      } else if (result.reason === 'duplicate') {
        errors.push(`Task "${task.name}" has duplicate link to "${predName}"`);
      }
    }
  }

  // Orphan summary tasks (parent_id set but parent doesn't exist)
  for (const task of tasks) {
    if (task.parent_id && !taskMap.has(task.parent_id)) {
      errors.push(`Task "${task.name}" has orphan parent_id: ${task.parent_id}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
