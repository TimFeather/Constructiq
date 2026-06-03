/**
 * ConstructIQ Schedule Engine — Architecture v2
 *
 * This is the single source of truth for schedule calculations.
 * NO React components may import this directly for rendering-time calculations.
 * All calculations happen here, results are passed as data to renderers.
 *
 * Supports:
 * - Full CPM (forward pass + backward pass)
 * - FS / SS / FF / SF dependency types
 * - Positive and negative lag (working and elapsed)
 * - All 8 MS Project constraint types
 * - 5-day / 6-day / 7-day calendars
 * - Public holidays and shutdown periods
 * - Milestone tasks (duration = 0)
 * - Summary task rollup (children define parent dates)
 * - Baseline variance
 * - Circular dependency detection
 */

import { buildDependencyGraph, wouldCreateCycle } from './dependencyGraph.js';
import { runCPM } from './criticalPath.js';
import { DEFAULT_CALENDAR, toDateStr, parseDate, nextWorkingDay } from './calendarEngine.js';

export { wouldCreateCycle };

/**
 * Run the full schedule engine on a task list.
 *
 * @param {Array} tasks - raw task objects from the database
 * @param {string} projectStartDate - fallback ASAP start (yyyy-MM-dd)
 * @param {Object} [calendar] - calendar configuration
 * @returns {Map<string, ScheduleResult>}
 *
 * ScheduleResult: {
 *   start: Date, finish: Date,
 *   startStr: string, finishStr: string,
 *   durationDays: number,
 *   isCritical: boolean,
 *   totalFloat: number,
 *   freeFloat: number,
 *   earlyStart: Date, earlyFinish: Date,
 *   lateStart: Date, lateFinish: Date,
 * }
 */
export function runScheduleEngine(tasks, projectStartDate, calendar = DEFAULT_CALENDAR) {
  if (!tasks || tasks.length === 0) return new Map();

  // Separate summary tasks (have children) from leaf tasks
  const childParentIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
  const leafTasks = tasks.filter(t => !childParentIds.has(t.id));
  const summaryTasks = tasks.filter(t => childParentIds.has(t.id));

  // Build dependency graph (for leaf tasks only — summary tasks use child rollup)
  const graph = buildDependencyGraph(tasks);

  // Determine project start
  const fallback = projectStartDate
    || tasks.reduce((min, t) => {
      if (!t.start_date) return min;
      return !min || t.start_date < min ? t.start_date : min;
    }, null)
    || toDateStr(new Date());

  // Run CPM on ALL tasks (engine handles summary internally)
  const cpmResult = runCPM(tasks, graph, fallback, calendar);

  // Rollup summary task dates from children
  rollupSummaryTasks(tasks, cpmResult, childParentIds);

  return cpmResult;
}

/**
 * Roll up summary task dates from their children's resolved dates.
 * Processes bottom-up so nested summaries are correct.
 */
function rollupSummaryTasks(tasks, resolvedMap, summaryIds) {
  if (!summaryIds.size) return;

  // Build parent→children map
  const children = new Map();
  for (const task of tasks) {
    if (!task.parent_id) continue;
    if (!children.has(task.parent_id)) children.set(task.parent_id, []);
    children.get(task.parent_id).push(task.id);
  }

  // Process summaries in reverse depth order (deepest first)
  const summaryList = tasks.filter(t => summaryIds.has(t.id));

  // Sort by WBS depth descending (deeper = more dots in WBS)
  summaryList.sort((a, b) => {
    const depthA = (a.wbs || '').split('.').length;
    const depthB = (b.wbs || '').split('.').length;
    return depthB - depthA;
  });

  for (const summary of summaryList) {
    const childIds = children.get(summary.id) || [];
    if (!childIds.length) continue;

    const childStarts = [];
    const childFinishes = [];
    let allCritical = true;

    for (const cid of childIds) {
      const r = resolvedMap.get(cid);
      if (!r) continue;
      childStarts.push(r.start || r.earlyStart);
      childFinishes.push(r.finish || r.earlyFinish);
      if (!r.isCritical) allCritical = false;
    }

    if (!childStarts.length) continue;

    const minStart = new Date(Math.min(...childStarts.map(d => d.getTime())));
    const maxFinish = new Date(Math.max(...childFinishes.map(d => d.getTime())));
    const durationDays = Math.max(1, Math.round((maxFinish - minStart) / 86400000) + 1);

    // Progress rollup — weighted average by duration
    const childProgressList = childIds
      .map(cid => tasks.find(t => t.id === cid))
      .filter(Boolean)
      .map(t => ({ pct: t.percent_complete || 0, dur: t.duration || 1 }));
    const totalDur = childProgressList.reduce((s, c) => s + c.dur, 0);
    const rolledProgress = totalDur > 0
      ? Math.round(childProgressList.reduce((s, c) => s + c.pct * c.dur, 0) / totalDur)
      : 0;

    const existing = resolvedMap.get(summary.id) || {};
    resolvedMap.set(summary.id, {
      ...existing,
      start: minStart,
      finish: maxFinish,
      earlyStart: minStart,
      earlyFinish: maxFinish,
      startStr: toDateStr(minStart),
      finishStr: toDateStr(maxFinish),
      durationDays,
      isCritical: allCritical,
      totalFloat: 0,
      freeFloat: 0,
      rolledProgress,
    });
  }
}

/**
 * Given a changed task, compute all affected patches and return them.
 * Does NOT write to the database — caller handles persistence.
 *
 * @param {string} changedTaskId
 * @param {Array} allTasks - full task list with the updated task already merged in
 * @param {string} projectStartDate
 * @param {Object} [calendar]
 * @returns {Array<{ id, start_date, end_date, duration }>}
 */
export function computeCascade(changedTaskId, allTasks, projectStartDate, calendar = DEFAULT_CALENDAR) {
  const scheduled = runScheduleEngine(allTasks, projectStartDate, calendar);
  const patches = [];

  for (const task of allTasks) {
    const resolved = scheduled.get(task.id);
    if (!resolved) continue;

    const newStart = resolved.startStr;
    const newEnd = resolved.finishStr;
    const newDur = resolved.durationDays;

    if (newStart !== task.start_date || newEnd !== task.end_date || newDur !== task.duration) {
      patches.push({ id: task.id, start_date: newStart, end_date: newEnd, duration: newDur });
    }
  }

  return patches;
}

/**
 * Check if a task is a milestone (duration === 0)
 */
export function isMilestone(task) {
  return task.is_milestone === true || task.duration === 0;
}

/**
 * Check if a task is a summary (has children)
 */
export function isSummaryTask(task, allTasks) {
  return allTasks.some(t => t.parent_id === task.id);
}