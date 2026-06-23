/**
 * ScheduleUpdateService — Single Source of Truth for all schedule mutations.
 *
 * ALL task edits that affect scheduling MUST go through this service.
 * No component may call Task.update() directly for
 * date/duration/dependency/constraint changes.
 *
 * Pipeline for every mutation:
 *   1. Merge the change into the in-memory task list
 *   2. Run the full schedule engine (CPM + rollup)
 *   3. Compute all patches (every task whose dates/duration changed)
 *   4. Persist ALL patches to the database in parallel
 *   5. Return the updated task list and scheduled map for UI refresh
 */

import { runScheduleEngine, computeCascade } from './scheduling/scheduleEngine.js';
import { Task } from '@/api/entities';
import { wouldCreateCycle } from './scheduling/scheduleEngine.js';

/**
 * Core update pipeline.
 * Merges `changes` into `allTasks`, runs the engine, persists all patches.
 *
 * @param {string}   taskId     - The task being directly edited
 * @param {Object}   changes    - Fields being changed on that task
 * @param {Array}    allTasks   - Full current task list from the database
 * @param {Function} updateFn   - async (id, data) => void  [Task.update]
 * @param {string}   [projectStart] - Project anchor date
 * @returns {Promise<{ patches: Array, scheduledMap: Map }>}
 */
export async function applyScheduleUpdate(taskId, changes, allTasks, updateFn, projectStart) {
  // 1. Merge change into task list
  const mergedTasks = allTasks.map(t =>
    t.id === taskId ? { ...t, ...changes } : t
  );

  // 2. Run full schedule engine
  const scheduledMap = runScheduleEngine(mergedTasks, projectStart);

  // 3. Compute all patches — every task whose stored dates differ from computed dates
  const patches = [];
  for (const task of mergedTasks) {
    const resolved = scheduledMap.get(task.id);
    if (!resolved) continue;
    const hasDateChange = resolved.startStr !== task.start_date || resolved.finishStr !== task.end_date;
    const hasDurChange = resolved.durationDays !== task.duration;
    if (hasDateChange || hasDurChange) {
      patches.push({
        id: task.id,
        start_date: resolved.startStr,
        end_date: resolved.finishStr,
        duration: resolved.durationDays,
      });
    }
  }

  // Also persist the direct changes to the edited task (non-scheduling fields
  // like name, percent_complete, predecessors, constraint, etc.)
  const directPatch = patches.find(p => p.id === taskId);
  const directChanges = directPatch
    ? { ...changes, start_date: directPatch.start_date, end_date: directPatch.end_date, duration: directPatch.duration }
    : changes;

  // 4. Persist: edited task first (with all its changes), then cascade patches
  // Serialize all writes with a small delay to stay under the API rate limit
  await updateFn(taskId, directChanges);

  const cascadePatches = patches.filter(p => p.id !== taskId);
  for (const p of cascadePatches) {
    await new Promise(r => setTimeout(r, 350));
    await updateFn(p.id, { start_date: p.start_date, end_date: p.end_date, duration: p.duration });
  }

  return { patches, scheduledMap, mergedTasks };
}

/**
 * Update a task's duration and cascade all successors.
 */
export async function updateTaskDuration(taskId, newDuration, allTasks, updateFn, projectStart) {
  return applyScheduleUpdate(
    taskId,
    { duration: Math.max(1, newDuration) },
    allTasks,
    updateFn,
    projectStart
  );
}

/**
 * Update a task's start date and cascade all successors.
 * When the start date changes, the task gets an MSO constraint so the
 * engine respects the user's intent, but preserves existing duration.
 */
export async function updateTaskStartDate(taskId, newStartDate, allTasks, updateFn, projectStart) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;

  // Setting start date directly = treat as SNET so engine won't push it earlier
  const changes = {
    start_date: newStartDate,
    constraint: { type: 'SNET', date: newStartDate },
  };

  return applyScheduleUpdate(taskId, changes, allTasks, updateFn, projectStart);
}

/**
 * Update a task's dependencies/predecessors and cascade.
 */
export async function updateTaskDependency(taskId, predecessors, allTasks, updateFn, projectStart) {
  // Validate: check for cycles
  const tasksWithNewDep = allTasks.map(t =>
    t.id === taskId ? { ...t, predecessors } : t
  );
  for (const pred of predecessors) {
    const pid = pred.predecessor_id || pred.task_id;
    if (pid && wouldCreateCycle(tasksWithNewDep, pid, taskId)) {
      throw new Error(`Circular dependency detected adding predecessor "${pid}" to task "${taskId}"`);
    }
  }

  return applyScheduleUpdate(taskId, { predecessors }, allTasks, updateFn, projectStart);
}

/**
 * Update a task's scheduling constraint and cascade.
 */
export async function updateTaskConstraint(taskId, constraint, allTasks, updateFn, projectStart) {
  return applyScheduleUpdate(taskId, { constraint }, allTasks, updateFn, projectStart);
}

/**
 * Update percent complete, actual_start, actual_finish.
 * Does NOT trigger schedule cascade (progress doesn't move other tasks).
 * But does update summary rollup via the engine.
 */
export async function updateTaskProgress(taskId, percent_complete, allTasks, updateFn, projectStart) {
  const changes = { percent_complete };

  // Set actual_start when first progress is recorded
  const task = allTasks.find(t => t.id === taskId);
  if (task && percent_complete > 0 && !task.actual_start) {
    changes.actual_start = new Date().toISOString().split('T')[0];
  }
  if (percent_complete === 100 && task && !task.actual_finish) {
    changes.actual_finish = new Date().toISOString().split('T')[0];
  }

  // Persist progress directly — no cascade needed
  await updateFn(taskId, changes);

  // Still re-run engine for summary rollup accuracy
  const mergedTasks = allTasks.map(t => t.id === taskId ? { ...t, ...changes } : t);
  const scheduledMap = runScheduleEngine(mergedTasks, projectStart);

  return { patches: [], scheduledMap, mergedTasks };
}

/**
 * Full task save (from TaskEditPanel) — handles all field types.
 * Detects which scheduling-relevant fields changed and runs cascade.
 */
export async function updateTaskFull(taskId, newData, allTasks, updateFn, projectStart) {
  const task = allTasks.find(t => t.id === taskId);
  if (!task) return;

  const scheduleFields = ['start_date', 'end_date', 'duration', 'predecessors', 'constraint'];
  const hasScheduleChange = scheduleFields.some(f => {
    const oldVal = JSON.stringify(task[f]);
    const newVal = JSON.stringify(newData[f]);
    return oldVal !== newVal;
  });

  if (hasScheduleChange) {
    return applyScheduleUpdate(taskId, newData, allTasks, updateFn, projectStart);
  } else {
    // Only non-scheduling fields changed — direct save, no cascade
    await updateFn(taskId, newData);
    const mergedTasks = allTasks.map(t => t.id === taskId ? { ...t, ...newData } : t);
    const scheduledMap = runScheduleEngine(mergedTasks, projectStart);
    return { patches: [], scheduledMap, mergedTasks };
  }
}

/**
 * Validate schedule integrity across a task list.
 * Returns { valid: boolean, errors: string[] }
 */
export function validateScheduleIntegrity(tasks) {
  const errors = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));

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

    // Circular dependency check (simplified — full check is in wouldCreateCycle)
    for (const pred of (task.predecessors || [])) {
      const pid = pred.predecessor_id || pred.task_id;
      if (!pid) continue;
      if (wouldCreateCycle(tasks, pid, task.id)) {
        errors.push(`Circular dependency detected involving task "${task.name}"`);
        break;
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