/**
 * overdue.js
 *
 * Overdue and due-soon checks for the Dashboard and Projects pages, on the
 * same terms as the Gantt and Look Ahead:
 *
 * - Leaf tasks only. A summary row's stored percent_complete is never kept
 *   current (the Gantt rolls it up from its children as it draws), so a
 *   finished summary would otherwise read as 0% and count as overdue.
 * - The engine's forecast finish, not the stored end_date. Progress saved on a
 *   published programme doesn't rewrite the following tasks' stored dates,
 *   but the engine moves them every time it runs.
 * - "Today" in local time (NZ), not UTC, which is a day behind until 1pm NZDT.
 */

import { runScheduleEngineByProject } from '@/lib/scheduling/scheduleEngine';

/** A date as yyyy-MM-dd in the browser's local time zone. */
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Every leaf task (one with no children), copied with `forecast_finish`: the
 * engine's finish for it, falling back to the stored end_date.
 *
 * @param {Array} tasks - engine-shape tasks (programmeTasksQuery), any projects
 * @param {Map<string, Object>} [programmesByProject] - project_id → programmes row
 * @returns {Array}
 */
export function forecastLeafTasks(tasks, programmesByProject) {
  if (!tasks?.length) return [];
  const parentIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
  const scheduled = runScheduleEngineByProject(tasks, programmesByProject || new Map());
  return tasks
    .filter(t => !parentIds.has(t.id))
    .map(t => ({ ...t, forecast_finish: scheduled.get(t.id)?.finishStr || t.end_date || null }));
}

const isUnfinished = (t) => (Number(t.percent_complete) || 0) < 100;

/** Unfinished, and its forecast finish is before `today` (yyyy-MM-dd). */
export function isOverdue(task, today = localDateStr()) {
  return isUnfinished(task) && !!task.forecast_finish && task.forecast_finish < today;
}

/** Unfinished, and its forecast finish falls in [from, to] (yyyy-MM-dd, inclusive). */
export function isDueBetween(task, from, to) {
  return isUnfinished(task) && !!task.forecast_finish
    && task.forecast_finish >= from && task.forecast_finish <= to;
}
