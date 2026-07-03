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
  addWorkingDays,
  addWorkingHours,
  addElapsedHours,
  nextWorkingDay,
  countWorkingDays,
  WORK_HOURS_PER_DAY,
  DEFAULT_CALENDAR,
} from './calendarEngine.js';

const FLOAT_TOLERANCE_HOURS = 0; // Tasks with ≤ this float are critical

/** Signed working days from a to b (positive when b is after a). */
function signedWorkingDays(a, b, calendar) {
  if (b >= a) return countWorkingDays(a, b, calendar);
  return -countWorkingDays(b, a, calendar);
}

/** Normalize a date input ('yyyy-MM-dd' string or Date) to a local-midnight Date. */
function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  return parseDate(value);
}

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

  // Dates are day-granular with INCLUSIVE finishes (a Mon–Fri task finishes
  // "Friday", meaning end of Friday). Crossing a finish→start boundary (FS)
  // therefore advances one extra working day: the successor starts the NEXT
  // working day after the predecessor's finish, exactly as MS Project
  // displays it. SS and FF compare like-for-like date points (no shift);
  // SF crosses start→finish the other way (one working day back).
  switch (type) {
    case 'FS': {
      // Successor starts the next working day after Predecessor EF + Lag
      const boundary = addWorkingDays(addLag(predEF, lagHours), 1, calendar);
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
      // Successor finishes the working day before Predecessor ES + Lag
      const boundaryFinish = addWorkingDays(addLag(predES, lagHours), -1, calendar);
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

  // Mirrors the forward-pass day-granular conventions: FS backs off one
  // extra working day (finish is the day BEFORE the successor's start),
  // SF advances one; SS and FF compare like-for-like.
  switch (type) {
    case 'FS': {
      // Predecessor LF ≤ the working day before (Successor LS - Lag)
      const boundary = addWorkingDays(subtractLag(succLS, lagHours), -1, calendar);
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
      // Predecessor LS ≤ the working day after (Successor LF - Lag)
      const boundary = addWorkingDays(subtractLag(succLF, lagHours), 1, calendar);
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
export function runCPM(tasks, graph, projectStartDate, calendar = DEFAULT_CALENDAR, options = {}) {
  if (!tasks.length) return new Map();

  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const sorted = topoSort(tasks, graph);
  const fallbackStart = parseDate(projectStartDate) || nextWorkingDay(new Date(), calendar);
  const dataDate = asDate(options.dataDate);

  // ─── Forward Pass ───────────────────────────────────────────────────────────
  const esMap = new Map();       // id → Date (Early Start)
  const efMap = new Map();       // id → Date (Early Finish)
  const pinnedComplete = new Set(); // tasks locked to actuals (100% complete)
  const conflictMap = new Map(); // id → { type, constraintDate, requiredDate }

  for (const task of sorted) {
    const durationHours = (task.duration || 1) * WORK_HOURS_PER_DAY;
    const isMilestone = task.is_milestone || task.duration === 0;
    const pct = Number(task.percent_complete) || 0;
    const preds = graph.predecessors.get(task.id) || [];
    const constraint = task.constraint || { type: 'ASAP' };

    // ── Completed tasks: pinned to actual dates, immovable ────────────────────
    if (pct >= 100) {
      const es = parseDate(task.actual_start) || parseDate(task.start_date) || fallbackStart;
      const ef = parseDate(task.actual_finish) || parseDate(task.end_date) || new Date(es);
      esMap.set(task.id, es);
      efMap.set(task.id, ef);
      pinnedComplete.add(task.id);
      continue;
    }

    // ── In-progress tasks: start pinned to actual; remaining work resumes at
    //    the data date (retained logic) ─────────────────────────────────────────
    if (pct > 0) {
      const es = parseDate(task.actual_start) || parseDate(task.start_date) || fallbackStart;
      let ef;
      if (isMilestone) {
        ef = new Date(es);
      } else {
        const totalDays = task.duration || 1;
        const remainingDays = Math.max(1, Math.ceil(totalDays * (1 - pct / 100)));
        const resumeAt = dataDate && dataDate > es
          ? nextWorkingDay(dataDate, calendar)
          : nextWorkingDay(es, calendar);
        ef = remainingDays <= 1 ? new Date(resumeAt) : addWorkingDays(resumeAt, remainingDays - 1, calendar);
        // Never finish before the classic ES+duration finish when there's no data date
        const classicEF = addWorkingHours(nextWorkingDay(es, calendar), durationHours - WORK_HOURS_PER_DAY, calendar);
        if (!dataDate && classicEF > ef) ef = classicEF;
      }
      esMap.set(task.id, es);
      efMap.set(task.id, ef);
      continue;
    }

    // ── Not-started tasks: true CPM ───────────────────────────────────────────
    // Tasks WITH predecessors derive their dates purely from the network:
    // they can be pulled earlier as well as pushed later. Tasks with no
    // predecessors anchor to their stored start date.
    let es = preds.length
      ? new Date(fallbackStart)
      : (parseDate(task.start_date) || new Date(fallbackStart));

    // 1. Floor constraints (can only push later)
    if (constraint.type === 'SNET' && constraint.date) {
      const snetDate = parseDate(constraint.date);
      if (snetDate && snetDate > es) es = snetDate;
    }
    if (constraint.type === 'FNET' && constraint.date) {
      const fnetDate = parseDate(constraint.date);
      if (fnetDate) {
        const neededStart = addWorkingHours(fnetDate, -(durationHours - WORK_HOURS_PER_DAY), calendar);
        if (neededStart > es) es = neededStart;
      }
    }

    // 2. Dependency boundaries (max across all predecessors)
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
    const dependencyDrivenES = new Date(es);

    // 3. Ceiling / pinning constraints — honoured, but a contradiction with
    //    the dependency-driven date is flagged instead of silently resolved.
    if (constraint.type === 'MSO' && constraint.date) {
      const msoDate = parseDate(constraint.date);
      if (msoDate) {
        if (dependencyDrivenES > msoDate) {
          conflictMap.set(task.id, {
            type: 'MSO', constraintDate: toDateStr(msoDate), requiredDate: toDateStr(dependencyDrivenES),
          });
        }
        es = msoDate;
      }
    }
    if (constraint.type === 'MFO' && constraint.date) {
      const mfoDate = parseDate(constraint.date);
      if (mfoDate) {
        const impliedStart = addWorkingHours(mfoDate, -(durationHours - WORK_HOURS_PER_DAY), calendar);
        if (dependencyDrivenES > impliedStart) {
          conflictMap.set(task.id, {
            type: 'MFO', constraintDate: toDateStr(mfoDate), requiredDate: toDateStr(dependencyDrivenES),
          });
        }
        es = impliedStart;
      }
    }
    if (constraint.type === 'SNLT' && constraint.date) {
      const snltDate = parseDate(constraint.date);
      if (snltDate && es > snltDate) {
        conflictMap.set(task.id, {
          type: 'SNLT', constraintDate: toDateStr(snltDate), requiredDate: toDateStr(dependencyDrivenES),
        });
        es = snltDate;
      }
    }

    // 4. Data date: remaining (unstarted) work cannot be scheduled in the past
    if (dataDate && dataDate > es) {
      es = new Date(dataDate);
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

    const isComplete = pinnedComplete.has(task.id);

    // Total float in WORKING hours (LS − ES counted in working days × 8),
    // so a one-day float over a weekend reads as 8h, not 72h.
    // Negative float is meaningful: it signals a constraint conflict or a
    // slip past a deadline-type constraint. Do NOT clamp it.
    let totalFloatHours = ls && es
      ? signedWorkingDays(es, ls, calendar) * WORK_HOURS_PER_DAY
      : 0;

    // Free float: how many working days this task can slip before it delays
    // any immediate successor. Computed per link type: the gap between the
    // boundary this task currently imposes and where the successor actually
    // sits (successors may be held later by other predecessors).
    let freeFloatHours = totalFloatHours;
    const succs = graph.successors.get(task.id) || [];
    for (const succ of succs) {
      const succES = esMap.get(succ.id);
      const succEF = efMap.get(succ.id);
      if (!succES) continue;
      const succTask = taskMap.get(succ.id);
      const succDurH = ((succTask && succTask.duration) || 1) * WORK_HOURS_PER_DAY;
      const { boundaryStart, boundaryFinish } = applyDependencyBoundary(succ, ef, es, succDurH, calendar);

      let gapDays = null;
      if (boundaryStart) gapDays = signedWorkingDays(boundaryStart, succES, calendar);
      if (boundaryFinish && succEF) {
        const finishGap = signedWorkingDays(boundaryFinish, succEF, calendar);
        gapDays = gapDays === null ? finishGap : Math.min(gapDays, finishGap);
      }
      if (gapDays !== null && gapDays * WORK_HOURS_PER_DAY < freeFloatHours) {
        freeFloatHours = gapDays * WORK_HOURS_PER_DAY;
      }
    }

    // Completed tasks are history — no float, never on the (remaining) critical path
    if (isComplete) {
      totalFloatHours = 0;
      freeFloatHours = 0;
    }

    const isCritical = !isComplete && totalFloatHours <= FLOAT_TOLERANCE_HOURS;

    // durationDays must stay in WORKING days (the unit the duration column
    // uses) — never the calendar-day span, which would silently inflate
    // durations across weekends when patches are persisted.
    const isMilestone = task.is_milestone || task.duration === 0;
    const durationDays = isMilestone ? 0 : (task.duration ?? 1);

    result.set(task.id, {
      earlyStart: es,
      earlyFinish: ef,
      lateStart: ls,
      lateFinish: lf,
      totalFloat: totalFloatHours,
      freeFloat: freeFloatHours,
      isCritical,
      hasNegativeFloat: totalFloatHours < 0,
      constraintConflict: conflictMap.get(task.id) || null,
      isComplete,
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