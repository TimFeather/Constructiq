/**
 * Critical Path Method (CPM) Engine
 * Implements full forward and backward pass calculations.
 *
 * Forward Pass:  calculates Early Start (ES) and Early Finish (EF)
 * Backward Pass: calculates Late Start (LS) and Late Finish (LF)
 * Float:         Total Float = LS - ES = LF - EF
 * Critical:      Float == 0 (or within tolerance)
 */

import { topoSort } from './dependencyGraph.js';
import {
  parseDate,
  toDateStr,
  addWorkingHours,
  addElapsedHours,
  nextWorkingDay,
  WORK_HOURS_PER_DAY,
  DEFAULT_CALENDAR,
} from './calendarEngine.js';

const FLOAT_TOLERANCE_HOURS = 0; // Tasks with ≤ this float are critical

/**
 * Apply a dependency constraint between predecessor and successor.
 * Returns the earliest start/finish the successor can take given this dependency.
 */
function applyDependencyBoundary(dep, predEF, predES, succDurationHours, calendar) {
  const type = dep.type || 'FS';
  const lagHours = dep.lagHours ?? 0;
  const isElapsed = dep.isElapsed || false;

  const addLag = (date, lag) =>
    isElapsed ? addElapsedHours(date, lag) : addWorkingHours(date, lag, calendar);

  switch (type) {
    case 'FS': {
      // Successor ES ≥ Predecessor EF + Lag
      const boundary = addLag(predEF, lagHours);
      return { boundaryStart: boundary, boundaryFinish: null };
    }
    case 'SS': {
      // Successor ES ≥ Predecessor ES + Lag
      const boundary = addLag(predES, lagHours);
      return { boundaryStart: boundary, boundaryFinish: null };
    }
    case 'FF': {
      // Successor EF ≥ Predecessor EF + Lag
      const boundaryFinish = addLag(predEF, lagHours);
      const boundaryStart = addWorkingHours(boundaryFinish, -succDurationHours + WORK_HOURS_PER_DAY, calendar);
      return { boundaryStart, boundaryFinish };
    }
    case 'SF': {
      // Successor EF ≥ Predecessor ES + Lag
      const boundaryFinish = addLag(predES, lagHours);
      const boundaryStart = addWorkingHours(boundaryFinish, -succDurationHours + WORK_HOURS_PER_DAY, calendar);
      return { boundaryStart, boundaryFinish };
    }
    default:
      return { boundaryStart: null, boundaryFinish: null };
  }
}

/**
 * Apply a backward-pass dependency boundary.
 * Returns the latest finish/start the predecessor can take.
 */
function applyBackwardBoundary(dep, succLS, succLF, predDurationHours, calendar) {
  const type = dep.type || 'FS';
  const lagHours = dep.lagHours ?? 0;
  const isElapsed = dep.isElapsed || false;

  const subtractLag = (date, lag) =>
    isElapsed ? addElapsedHours(date, -lag) : addWorkingHours(date, -lag, calendar);

  switch (type) {
    case 'FS': {
      // Predecessor LF ≤ Successor LS - Lag
      const boundary = subtractLag(succLS, lagHours);
      return { boundaryLF: boundary };
    }
    case 'SS': {
      // Predecessor LS ≤ Successor LS - Lag
      const boundary = subtractLag(succLS, lagHours);
      const boundaryLF = addWorkingHours(boundary, predDurationHours - WORK_HOURS_PER_DAY, calendar);
      return { boundaryLS: boundary, boundaryLF };
    }
    case 'FF': {
      // Predecessor LF ≤ Successor LF - Lag
      const boundary = subtractLag(succLF, lagHours);
      return { boundaryLF: boundary };
    }
    case 'SF': {
      // Predecessor LS ≤ Successor LF - Lag
      const boundary = subtractLag(succLF, lagHours);
      const boundaryLF = addWorkingHours(boundary, predDurationHours - WORK_HOURS_PER_DAY, calendar);
      return { boundaryLS: boundary, boundaryLF };
    }
    default:
      return {};
  }
}

/**
 * Run full CPM calculation on a task list.
 *
 * @param {Array} tasks - task list (already has start_date, duration, predecessors)
 * @param {Map} graph - dependency graph from buildDependencyGraph()
 * @param {string} projectStartDate - fallback ASAP anchor
 * @param {Object} calendar - calendar config
 * @returns {Map<id, CPMResult>}
 *
 * CPMResult: {
 *   earlyStart: Date, earlyFinish: Date,
 *   lateStart: Date, lateFinish: Date,
 *   totalFloat: number (hours),
 *   freeFloat: number (hours),
 *   isCritical: boolean,
 *   startStr: string, finishStr: string, durationDays: number
 * }
 */
export function runCPM(tasks, graph, projectStartDate, calendar = DEFAULT_CALENDAR) {
  if (!tasks.length) return new Map();

  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const sorted = topoSort(tasks, graph);
  const fallbackStart = parseDate(projectStartDate) || nextWorkingDay(new Date(), calendar);

  // ─── Forward Pass ───────────────────────────────────────────────────────────
  const esMap = new Map(); // id → Date (Early Start)
  const efMap = new Map(); // id → Date (Early Finish)

  for (const task of sorted) {
    const durationHours = (task.duration || 1) * WORK_HOURS_PER_DAY;
    const isMilestone = task.is_milestone || task.duration === 0;

    // Determine initial early start from constraint or stored date
    const constraint = task.constraint || { type: 'ASAP' };
    let es = parseDate(task.start_date) || fallbackStart;

    // Apply forward-pass constraints
    if (constraint.type === 'SNET' && constraint.date) {
      const snetDate = parseDate(constraint.date);
      if (snetDate && snetDate > es) es = snetDate;
    }
    if (constraint.type === 'SNLT' && constraint.date) {
      // Start No Later Than — caps the latest allowed start (enforced in forward pass)
      const snltDate = parseDate(constraint.date);
      if (snltDate && es > snltDate) es = snltDate;
    }
    if (constraint.type === 'MSO' && constraint.date) {
      es = parseDate(constraint.date) || es;
    }
    if (constraint.type === 'MFO' && constraint.date) {
      const mfoDate = parseDate(constraint.date);
      if (mfoDate) {
        es = addWorkingHours(mfoDate, -(durationHours - WORK_HOURS_PER_DAY), calendar);
      }
    }
    if (constraint.type === 'FNET' && constraint.date) {
      const fnetDate = parseDate(constraint.date);
      if (fnetDate) {
        const neededStart = addWorkingHours(fnetDate, -(durationHours - WORK_HOURS_PER_DAY), calendar);
        if (neededStart > es) es = neededStart;
      }
    }

    // Apply predecessor dependencies
    const preds = graph.predecessors.get(task.id) || [];
    for (const dep of preds) {
      const predES = esMap.get(dep.id);
      const predEF = efMap.get(dep.id);
      if (!predES || !predEF) continue;

      const { boundaryStart, boundaryFinish } = applyDependencyBoundary(
        dep, predEF, predES, durationHours, calendar
      );

      if (boundaryStart && boundaryStart > es) {
        es = boundaryStart;
      }
      if (boundaryFinish) {
        const impliedStart = addWorkingHours(boundaryFinish, -(durationHours - WORK_HOURS_PER_DAY), calendar);
        if (impliedStart > es) es = impliedStart;
      }
    }

    // Snap to next working day
    es = nextWorkingDay(es, calendar);

    const ef = isMilestone
      ? new Date(es)
      : addWorkingHours(es, durationHours - WORK_HOURS_PER_DAY, calendar);

    esMap.set(task.id, es);
    efMap.set(task.id, ef);
  }

  // ─── Project End Date ────────────────────────────────────────────────────────
  let projectEnd = new Date(0);
  efMap.forEach(ef => { if (ef > projectEnd) projectEnd = ef; });

  // ─── ALAP: push tasks with no successors to end of project ──────────────────
  for (const task of sorted) {
    const constraint = task.constraint || { type: 'ASAP' };
    if (constraint.type !== 'ALAP') continue;
    const succs = graph.successors.get(task.id) || [];
    if (succs.length > 0) continue; // ALAP only applies to tasks with no successors
    const durationHours = (task.duration || 1) * WORK_HOURS_PER_DAY;
    const isMilestone = task.is_milestone || task.duration === 0;
    const newEF = new Date(projectEnd);
    const newES = isMilestone
      ? new Date(newEF)
      : addWorkingHours(newEF, -(durationHours - WORK_HOURS_PER_DAY), calendar);
    esMap.set(task.id, newES);
    efMap.set(task.id, newEF);
  }

  // ─── Backward Pass ───────────────────────────────────────────────────────────
  const lsMap = new Map();
  const lfMap = new Map();

  // Initialize with project end
  for (const task of tasks) {
    lsMap.set(task.id, new Date(projectEnd));
    lfMap.set(task.id, new Date(projectEnd));
  }

  // Process in reverse topological order
  const reverseSorted = [...sorted].reverse();

  for (const task of reverseSorted) {
    const durationHours = (task.duration || 1) * WORK_HOURS_PER_DAY;
    const isMilestone = task.is_milestone || task.duration === 0;
    let lf = lfMap.get(task.id);

    // Apply constraints that restrict late finish
    const constraint = task.constraint || { type: 'ASAP' };
    if (constraint.type === 'FNLT' && constraint.date) {
      const fnltDate = parseDate(constraint.date);
      if (fnltDate && fnltDate < lf) lf = fnltDate;
    }
    if (constraint.type === 'MFO' && constraint.date) {
      lf = parseDate(constraint.date) || lf;
    }

    const ls = isMilestone
      ? new Date(lf)
      : addWorkingHours(lf, -(durationHours - WORK_HOURS_PER_DAY), calendar);

    lsMap.set(task.id, ls);
    lfMap.set(task.id, lf);

    // Push constraints backward to predecessors
    const preds = graph.predecessors.get(task.id) || [];
    for (const dep of preds) {
      const predTask = taskMap.get(dep.id);
      if (!predTask) continue;
      const predDurationHours = (predTask.duration || 1) * WORK_HOURS_PER_DAY;

      const { boundaryLF, boundaryLS } = applyBackwardBoundary(
        dep, ls, lf, predDurationHours, calendar
      );

      if (boundaryLF !== undefined && boundaryLF < lfMap.get(dep.id)) {
        lfMap.set(dep.id, boundaryLF);
      }
      if (boundaryLS !== undefined && boundaryLS < lsMap.get(dep.id)) {
        lsMap.set(dep.id, boundaryLS);
      }
    }
  }

  // ─── Float Calculation ───────────────────────────────────────────────────────
  const result = new Map();

  for (const task of tasks) {
    const es = esMap.get(task.id);
    const ef = efMap.get(task.id);
    const ls = lsMap.get(task.id);
    const lf = lfMap.get(task.id);

    if (!es || !ef) continue;

    const totalFloatHours = ls && es ? Math.round((ls.getTime() - es.getTime()) / 3600000) : 0;

    // Free float: how much this task can be delayed without delaying its immediate successors
    let freeFloatHours = totalFloatHours;
    const succs = graph.successors.get(task.id) || [];
    for (const succ of succs) {
      const succES = esMap.get(succ.id);
      if (!succES) continue;
      const gap = Math.round((succES.getTime() - ef.getTime()) / 3600000);
      if (gap < freeFloatHours) freeFloatHours = gap;
    }
    freeFloatHours = Math.max(0, freeFloatHours);

    const isCritical = totalFloatHours <= FLOAT_TOLERANCE_HOURS;

    const durationDays = task.duration === 0 ? 0 : Math.max(1, Math.round(
      (ef.getTime() - es.getTime()) / 86400000
    ) + 1);

    result.set(task.id, {
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat: Math.max(0, totalFloatHours),
      freeFloat: freeFloatHours,
      isCritical,
      // Convenience output fields
      start: es,
      finish: ef,
      startStr: toDateStr(es),
      finishStr: toDateStr(ef),
      durationDays,
    });
  }

  return result;
}