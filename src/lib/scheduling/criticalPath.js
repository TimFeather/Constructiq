/**
 * Critical Path Method (CPM) Engine
 * Implements full forward and backward pass calculations.
 *
 * Forward Pass:  calculates Early Start (ES) and Early Finish (EF)
 * Backward Pass: calculates Late Start (LS) and Late Finish (LF)
 * Float:         Total Float = LS - ES = LF - EF
 * Critical:      Float == 0 (or within tolerance)
 *
 * ── Continuous working-hour timeline ────────────────────────────────────────
 * All schedule maths runs on a NUMBER timeline: working hours elapsed since the
 * START (08:00) of the project anchor day. Each working day contributes exactly
 * WORK_HOURS_PER_DAY (8) hours; weekends/holidays/shutdowns contribute nothing.
 * This lets sub-day tasks pack into a single calendar day the way MS Project
 * schedules clock hours inside 08:00–17:00 — a 4h task finishing at 12:00 and
 * its FS successor starting 13:00 both live on the same day. Dates are derived
 * (via calendarEngine helpers) only at the edges. FS is pure arithmetic
 * (succES_h = predEF_h + lag_h) — NO hardcoded +1-day shift; same-day packing
 * or day rollover falls out of the numbers.
 *
 * Inclusive-finish display convention: startStr is the day CONTAINING ES_h;
 * finishStr is the day containing (EF_h − ε). An 8h task at hour 0 shows the
 * same day for start and finish; two 4h FS tasks share start AND finish day.
 */

import { topoSort } from './dependencyGraph.js';
import {
  parseDate,
  toDateStr,
  nextWorkingDay,
  dateToWorkingHours,
  workingHoursToDate,
  addElapsedHours,
  workingHourToInstant,
  instantToWorkingHours,
  WORK_HOURS_PER_DAY,
  DEFAULT_CALENDAR,
} from './calendarEngine.js';

const FLOAT_TOLERANCE_HOURS = 0; // Base: tasks with ≤ this float are critical
const EPSILON_HOURS = 1e-6;      // nudge finishes onto the inclusive day

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
 * Apply a dependency constraint between predecessor and successor, ON THE
 * WORKING-HOUR TIMELINE. All inputs/outputs are hour numbers.
 *
 * FS: succES_h ≥ predEF_h + lag         (no day shift — packing is emergent)
 * SS: succES_h ≥ predES_h + lag
 * FF: succEF_h ≥ predEF_h + lag
 * SF: succEF_h ≥ predES_h + lag
 *
 * Elapsed lag (dep.isElapsed) is 24/7 wall-clock, not working time. Convention:
 * convert the boundary hour → its real-clock instant via workingHourToInstant
 * (finish-type anchors resolve a whole-day boundary to 16:00 of the previous
 * working day; start-type anchors resolve it to 08:00), add the elapsed hours
 * as real clock time, then map back to the working-hour timeline via
 * instantToWorkingHours (which snaps a landing in non-working time forward to
 * the next working instant). This mixes the two clocks at the link boundary
 * only.
 */
function applyDependencyBoundary(dep, predEF_h, predES_h, anchor, calendar) {
  const type = dep.type || 'FS';
  const lagHours = dep.lagHours ?? 0;
  const isElapsed = dep.isElapsed || false;

  // FS/FF anchor off the predecessor's FINISH; SS/SF anchor off its START.
  // Elapsed lag needs to know which so a whole-day boundary resolves to the
  // right real-clock instant (end of previous working day vs start of next).
  const addLag = (h, lag, isFinishAnchor) => {
    if (!isElapsed) return h + lag;
    const instant = workingHourToInstant(h, anchor, calendar, { finishBoundary: isFinishAnchor });
    const shifted = addElapsedHours(instant, lag);
    return instantToWorkingHours(shifted, anchor, calendar);
  };

  switch (type) {
    case 'FS':
      return { boundaryStart_h: addLag(predEF_h, lagHours, true), boundaryFinish_h: null };
    case 'SS':
      return { boundaryStart_h: addLag(predES_h, lagHours, false), boundaryFinish_h: null };
    case 'FF':
      return { boundaryStart_h: null, boundaryFinish_h: addLag(predEF_h, lagHours, true) };
    case 'SF':
      return { boundaryStart_h: null, boundaryFinish_h: addLag(predES_h, lagHours, false) };
    default:
      return { boundaryStart_h: null, boundaryFinish_h: null };
  }
}

/**
 * Backward-pass dependency boundary on the working-hour timeline. Mirrors the
 * forward pass. Inputs/outputs are hour numbers; returns the latest LF/LS the
 * predecessor may take under this link.
 *
 * FS: predLF_h ≤ succLS_h − lag
 * SS: predLS_h ≤ succLS_h − lag
 * FF: predLF_h ≤ succLF_h − lag
 * SF: predLS_h ≤ succLF_h − lag
 */
function applyBackwardBoundary(dep, succLS_h, succLF_h, anchor, calendar) {
  const type = dep.type || 'FS';
  const lagHours = dep.lagHours ?? 0;
  const isElapsed = dep.isElapsed || false;

  // succLS is a start-type anchor (finishBoundary: false); succLF is a
  // finish-type anchor (finishBoundary: true) — mirrors the forward pass.
  const subLag = (h, lag, isFinishAnchor) => {
    if (!isElapsed) return h - lag;
    const instant = workingHourToInstant(h, anchor, calendar, { finishBoundary: isFinishAnchor });
    const shifted = addElapsedHours(instant, -lag);
    return instantToWorkingHours(shifted, anchor, calendar);
  };

  switch (type) {
    case 'FS':
      return { boundaryLF_h: subLag(succLS_h, lagHours, false) };
    case 'SS':
      return { boundaryLS_h: subLag(succLS_h, lagHours, false) };
    case 'FF':
      return { boundaryLF_h: subLag(succLF_h, lagHours, true) };
    case 'SF':
      return { boundaryLS_h: subLag(succLF_h, lagHours, true) };
    default:
      return {};
  }
}

/**
 * Snap an hour value forward to the next working INSTANT. A whole-day multiple
 * of 8 is already a working-day start. A value landing in non-working time
 * (only reachable via elapsed-lag round-trips) is mapped through its date.
 * For the common (working-hours) path this is the identity, but it guards the
 * ES-snap semantics (`nextWorkingDay` on the old day timeline).
 */
function snapForward(h, anchor, calendar) {
  // On the pure working-hour timeline every hour is already "working time":
  // the timeline skips non-working days by construction. The only way to land
  // off-grid is elapsed lag, which dateToWorkingHours already snaps forward.
  return h;
}

/** startStr / earlyStart Date: the day containing ES_h. */
function startDate(h, anchor, calendar) {
  return workingHoursToDate(h, anchor, calendar);
}

/**
 * finishStr / earlyFinish Date: the day containing (EF_h − ε), giving the
 * INCLUSIVE finish. An 8h task (EF_h = 8) finishes on its start day, not the
 * next day. A zero-length span (milestone, EF_h = ES_h) uses ES_h directly.
 */
function finishDate(ef_h, es_h, anchor, calendar) {
  if (ef_h <= es_h + EPSILON_HOURS) return workingHoursToDate(es_h, anchor, calendar);
  return workingHoursToDate(ef_h - EPSILON_HOURS, anchor, calendar);
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
  const summaryIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
  const sorted = topoSort(tasks, graph);
  const fallbackStart = parseDate(projectStartDate) || nextWorkingDay(new Date(), calendar);
  // Anchor for the working-hour timeline: hour 0 ≡ start (08:00) of this day.
  const anchor = nextWorkingDay(fallbackStart, calendar);
  const dataDate = asDate(options.dataDate);
  const dataDate_h = dataDate ? dateToWorkingHours(dataDate, anchor, calendar) : null;
  // Adjustable critical threshold (MS Project's "tasks are critical if slack
  // is ≤ N days"). Widens the critical net: N=0 flags only true zero-float
  // tasks; larger N additionally flags near-critical tasks.
  const criticalToleranceHours =
    FLOAT_TOLERANCE_HOURS + Math.max(0, Number(options.criticalToleranceDays) || 0) * WORK_HOURS_PER_DAY;

  /** yyyy-MM-dd string / Date → hour offset for a START-type point (null-safe). */
  const dh = (d) => {
    const dt = asDate(d);
    return dt ? dateToWorkingHours(dt, anchor, calendar) : null;
  };
  /**
   * A finish-type constraint/actual DATE → hour offset of its INCLUSIVE end
   * (end of that working day = day start + WORK_HOURS_PER_DAY).
   */
  const finishHourOf = (d) => {
    const h = dh(d);
    return h === null ? null : h + WORK_HOURS_PER_DAY;
  };

  // ─── Forward Pass (hour timeline) ────────────────────────────────────────────
  const esMap = new Map();       // id → ES hours
  const efMap = new Map();       // id → EF hours
  const pinnedComplete = new Set(); // tasks locked to actuals (100% complete)
  const conflictMap = new Map(); // id → { type, constraintDate, requiredDate }
  // Milestones collapse ES/EF to one hour, so a boundary that lands exactly on
  // a day multiple is ambiguous between "start of this working day" (FS/SS/
  // MSO/SNET-derived) and "end of the previous working day" (FF/SF/MFO/FNET-
  // derived — the milestone occurs AT the predecessor's finish, same day).
  // Track which flavour won so the display step can pick the right day without
  // perturbing the raw hour used by this milestone's own successors.
  const milestoneFinishTypeMap = new Map(); // id → boolean

  /**
   * Max dependency boundary (hour) across predecessors — the earliest ES the
   * network allows. `value` is -Infinity when no predecessor has been placed.
   * `isFinishType` says whether the winning contribution was a finish-type
   * link (FF/SF) rather than a start-type one (FS/SS) — ties favour finish.
   */
  const networkBoundary_h = (preds, durationHours) => {
    let b = -Infinity;
    let isFinishType = false;
    for (const dep of preds) {
      const predES_h = esMap.get(dep.id);
      const predEF_h = efMap.get(dep.id);
      if (predES_h === undefined || predEF_h === undefined) continue;
      const { boundaryStart_h, boundaryFinish_h } = applyDependencyBoundary(
        dep, predEF_h, predES_h, anchor, calendar
      );
      if (boundaryStart_h !== null && boundaryStart_h > b) { b = boundaryStart_h; isFinishType = false; }
      if (boundaryFinish_h !== null) {
        const impliedStart_h = boundaryFinish_h - durationHours;
        if (impliedStart_h >= b) { b = impliedStart_h; isFinishType = true; }
      }
    }
    return { value: b, isFinishType };
  };

  /**
   * Actuals are stored as day-granular dates, which lose WHERE in the day a
   * task started (MS Project packs a 4h task after a 12:00 predecessor finish
   * into the 13:00 slot). Recover the intra-day position from the network:
   * when a predecessor boundary falls strictly WITHIN the recorded actual-start
   * day, the task began there, not at 08:00. The displayed start DAY is
   * unaffected — this only refines the hour inside it.
   */
  const refineWithinDay = (dayStart_h, preds, durationHours) => {
    const { value: b } = networkBoundary_h(preds, durationHours);
    if (b > dayStart_h && b < dayStart_h + WORK_HOURS_PER_DAY) return b;
    return dayStart_h;
  };

  for (const task of sorted) {
    const durationHours = (task.duration || 1) * WORK_HOURS_PER_DAY;
    const isMilestone = task.is_milestone || task.duration === 0;
    // Milestones occupy zero width on the hour line for boundary purposes
    // (FF/FNET/MFO), even though durationHours above is a non-zero fallback
    // used elsewhere. ef_h calculations already branch on isMilestone directly.
    const boundaryDurationHours = isMilestone ? 0 : durationHours;
    const pct = Number(task.percent_complete) || 0;
    const preds = graph.predecessors.get(task.id) || [];
    const constraint = task.constraint || { type: 'ASAP' };

    // ── Completed tasks: pinned to actual dates, immovable ────────────────────
    // ES_h = start of actual_start day. EF is governed by actual_finish's DAY —
    // a task that finished early or late finished on that day, full stop. The
    // only freedom is the HOUR within that day: when the duration-derived
    // finish (actual_start + durationHours) lands inside the actual_finish day,
    // use it so a sub-day completed task (4h → 12:00) exposes an intra-day EF_h
    // and a same-day successor can pack after it. Otherwise fall back to the
    // inclusive end of the actual_finish day (old day-granular behaviour).
    if (pct >= 100) {
      let es_h = dh(task.actual_start || task.start_date) ?? 0;
      es_h = refineWithinDay(es_h, preds, boundaryDurationHours);
      const durEF_h = isMilestone ? es_h : es_h + durationHours;
      const finDay_h = dh(task.actual_finish || task.end_date);
      let ef_h;
      if (finDay_h === null) {
        // No recorded finish: old engine displayed the start day; keep that,
        // but let a sub-day duration expose its intra-day finish hour.
        ef_h = isMilestone ? es_h : Math.min(durEF_h, es_h + WORK_HOURS_PER_DAY);
      } else if (durEF_h > finDay_h && durEF_h <= finDay_h + WORK_HOURS_PER_DAY) {
        ef_h = durEF_h; // duration finish falls within the actual_finish day
      } else {
        ef_h = finDay_h + WORK_HOURS_PER_DAY; // inclusive end of actual_finish day
      }
      esMap.set(task.id, es_h);
      efMap.set(task.id, ef_h);
      pinnedComplete.add(task.id);
      continue;
    }

    // ── In-progress tasks: start pinned to actual; remaining work resumes at
    //    the data date (retained logic, ported to hours) ───────────────────────
    if (pct > 0) {
      let es_h = dh(task.actual_start || task.start_date) ?? 0;
      es_h = refineWithinDay(es_h, preds, boundaryDurationHours);
      let ef_h;
      if (isMilestone) {
        ef_h = es_h;
      } else {
        const totalDays = task.duration || 1;
        const remainingDays = Math.max(1, Math.ceil(totalDays * (1 - pct / 100)));
        // resumeAt = start of the resume working day: the data date if it's
        // past the start, else the start day itself (the old engine's
        // nextWorkingDay(es) — which is es when es is a working day).
        const resumeStart_h = (dataDate_h !== null && dataDate_h > es_h)
          ? dataDate_h
          : es_h;
        // remainingDays whole working days from resume; inclusive finish is
        // resume + remainingDays*8 (EF_h is the exclusive end of the span).
        ef_h = resumeStart_h + remainingDays * WORK_HOURS_PER_DAY;
        // Never finish before the classic ES+duration finish when there's no data date.
        const classicEF_h = es_h + durationHours;
        if (dataDate_h === null && classicEF_h > ef_h) ef_h = classicEF_h;
      }
      esMap.set(task.id, es_h);
      efMap.set(task.id, ef_h);
      continue;
    }

    // ── Not-started tasks: true CPM ───────────────────────────────────────────
    // Tasks WITH predecessors derive purely from the network (can be pulled
    // earlier as well as pushed later). Tasks with no predecessors anchor to
    // their stored start date. If NO predecessor could be placed (dangling id,
    // or a dependency cycle left the preds unsorted), fall back to the stored
    // start date — never the project anchor.
    const { value: netBoundary_h, isFinishType: netBoundaryIsFinishType } =
      networkBoundary_h(preds, boundaryDurationHours);
    let es_h = (preds.length && netBoundary_h !== -Infinity)
      ? 0
      : (task.start_date ? dh(task.start_date) : 0);
    let esKindFinish = false; // which flavour of boundary last set es_h (milestone display only)

    // 1. Floor constraints (can only push later)
    if (constraint.type === 'SNET' && constraint.date) {
      const snet_h = dh(constraint.date);
      if (snet_h > es_h) { es_h = snet_h; esKindFinish = false; }
    }
    if (constraint.type === 'FNET' && constraint.date) {
      // Task must not finish before this day's inclusive end.
      const neededStart_h = finishHourOf(constraint.date) - boundaryDurationHours;
      if (neededStart_h > es_h) { es_h = neededStart_h; esKindFinish = true; }
    }

    // 2. Dependency boundaries (max across all predecessors)
    if (netBoundary_h > es_h) { es_h = netBoundary_h; esKindFinish = netBoundaryIsFinishType; }
    const dependencyDrivenES_h = es_h;

    // 3. Ceiling / pinning constraints — honoured, contradiction flagged.
    if (constraint.type === 'MSO' && constraint.date) {
      const mso_h = dh(constraint.date);
      if (dependencyDrivenES_h > mso_h) {
        conflictMap.set(task.id, {
          type: 'MSO',
          constraintDate: toDateStr(asDate(constraint.date)),
          requiredDate: toDateStr(startDate(dependencyDrivenES_h, anchor, calendar)),
        });
      }
      es_h = mso_h;
      esKindFinish = false;
    }
    if (constraint.type === 'MFO' && constraint.date) {
      const impliedStart_h = finishHourOf(constraint.date) - boundaryDurationHours;
      if (dependencyDrivenES_h > impliedStart_h) {
        conflictMap.set(task.id, {
          type: 'MFO',
          constraintDate: toDateStr(asDate(constraint.date)),
          requiredDate: toDateStr(startDate(dependencyDrivenES_h, anchor, calendar)),
        });
      }
      es_h = impliedStart_h;
      esKindFinish = true;
    }
    if (constraint.type === 'SNLT' && constraint.date) {
      const snlt_h = dh(constraint.date);
      if (es_h > snlt_h) {
        conflictMap.set(task.id, {
          type: 'SNLT',
          constraintDate: toDateStr(asDate(constraint.date)),
          requiredDate: toDateStr(startDate(dependencyDrivenES_h, anchor, calendar)),
        });
        es_h = snlt_h;
        esKindFinish = false;
      }
    }

    // 4. Data date: remaining (unstarted) work cannot be scheduled in the past.
    if (dataDate_h !== null && dataDate_h > es_h) {
      es_h = dataDate_h;
      esKindFinish = false;
    }

    // Snap to next working instant.
    es_h = snapForward(es_h, anchor, calendar);

    const ef_h = isMilestone ? es_h : es_h + durationHours;

    esMap.set(task.id, es_h);
    efMap.set(task.id, ef_h);
    if (isMilestone) milestoneFinishTypeMap.set(task.id, esKindFinish);
  }

  // ─── Project End (hours) ─────────────────────────────────────────────────────
  // Summary tasks carry stale rolled-up dates from the PREVIOUS engine run (they
  // schedule through CPM as ordinary tasks using stored start/duration), so they
  // must not anchor project end for THIS run. Fall back to the all-task max only
  // if the programme somehow contains nothing but summaries.
  let projectEnd_h = -Infinity;
  efMap.forEach((ef, id) => { if (!summaryIds.has(id) && ef > projectEnd_h) projectEnd_h = ef; });
  if (projectEnd_h === -Infinity) efMap.forEach(ef => { if (ef > projectEnd_h) projectEnd_h = ef; });
  if (projectEnd_h === -Infinity) projectEnd_h = 0;

  // ─── ALAP: push tasks with no successors to end of project ──────────────────
  for (const task of sorted) {
    const constraint = task.constraint || { type: 'ASAP' };
    if (constraint.type !== 'ALAP') continue;
    const succs = graph.successors.get(task.id) || [];
    if (succs.length > 0) continue;
    // Never move tasks pinned to actuals: completed or in-progress work stays put.
    if (pinnedComplete.has(task.id)) continue;
    if ((Number(task.percent_complete) || 0) > 0) continue;
    const durationHours = (task.duration || 1) * WORK_HOURS_PER_DAY;
    const isMilestone = task.is_milestone || task.duration === 0;
    const newEF_h = projectEnd_h;
    const newES_h = isMilestone ? newEF_h : newEF_h - durationHours;
    esMap.set(task.id, newES_h);
    efMap.set(task.id, newEF_h);
  }

  // ─── Backward Pass (hours) ───────────────────────────────────────────────────
  const lsMap = new Map();
  const lfMap = new Map();

  for (const task of tasks) {
    lsMap.set(task.id, projectEnd_h);
    lfMap.set(task.id, projectEnd_h);
  }

  const reverseSorted = [...sorted].reverse();

  for (const task of reverseSorted) {
    const durationHours = (task.duration || 1) * WORK_HOURS_PER_DAY;
    const isMilestone = task.is_milestone || task.duration === 0;
    let lf_h = lfMap.get(task.id);

    const constraint = task.constraint || { type: 'ASAP' };
    if (constraint.type === 'FNLT' && constraint.date) {
      const fnlt_h = finishHourOf(constraint.date);
      if (fnlt_h < lf_h) lf_h = fnlt_h;
    }
    if (constraint.type === 'MFO' && constraint.date) {
      lf_h = finishHourOf(constraint.date);
    }
    if (constraint.type === 'SNLT' && constraint.date) {
      const snltLF_h = isMilestone ? dh(constraint.date) : dh(constraint.date) + durationHours;
      if (snltLF_h < lf_h) lf_h = snltLF_h;
    }
    if (constraint.type === 'MSO' && constraint.date) {
      lf_h = isMilestone ? dh(constraint.date) : dh(constraint.date) + durationHours;
    }

    const ls_h = isMilestone ? lf_h : lf_h - durationHours;

    lsMap.set(task.id, ls_h);
    lfMap.set(task.id, lf_h);

    // Push constraints backward to predecessors. Completed work is history — it
    // should not constrain (or relax) the float of live predecessor tasks.
    if (pinnedComplete.has(task.id)) continue;
    const preds = graph.predecessors.get(task.id) || [];
    for (const dep of preds) {
      const predTask = taskMap.get(dep.id);
      if (!predTask) continue;

      const { boundaryLF_h, boundaryLS_h } = applyBackwardBoundary(
        dep, ls_h, lf_h, anchor, calendar
      );

      if (boundaryLF_h !== undefined && boundaryLF_h < lfMap.get(dep.id)) {
        lfMap.set(dep.id, boundaryLF_h);
      }
      if (boundaryLS_h !== undefined) {
        const predDurationHours = (predTask.duration || 1) * WORK_HOURS_PER_DAY;
        const predIsMilestone = predTask.is_milestone || predTask.duration === 0;
        const impliedLF_h = predIsMilestone ? boundaryLS_h : boundaryLS_h + predDurationHours;
        if (impliedLF_h < lfMap.get(dep.id)) lfMap.set(dep.id, impliedLF_h);
      }
    }
  }

  // ─── Float Calculation ───────────────────────────────────────────────────────
  const result = new Map();

  for (const task of tasks) {
    const es_h = esMap.get(task.id);
    const ef_h = efMap.get(task.id);
    const lf_h = lfMap.get(task.id);
    let ls_h = lsMap.get(task.id);

    if (es_h === undefined || ef_h === undefined) continue;

    const isComplete = pinnedComplete.has(task.id);
    const isMilestone = task.is_milestone || task.duration === 0;
    const durationHours = (task.duration || 1) * WORK_HOURS_PER_DAY;

    // LS derived from LF for consistency with the forward span.
    if (ls_h === undefined) ls_h = isMilestone ? lf_h : lf_h - durationHours;

    // Total float in WORKING hours, directly LS_h − ES_h. Negative float is
    // meaningful (constraint conflict / deadline slip). Do NOT clamp it.
    let totalFloatHours = (ls_h !== undefined && es_h !== undefined) ? ls_h - es_h : 0;

    // Free float: gap (working hours) between the boundary this task imposes on
    // each successor and where that successor actually sits.
    let freeFloatHours = totalFloatHours;
    const succs = graph.successors.get(task.id) || [];
    for (const succ of succs) {
      const succES_h = esMap.get(succ.id);
      const succEF_h = efMap.get(succ.id);
      if (succES_h === undefined) continue;
      const { boundaryStart_h, boundaryFinish_h } = applyDependencyBoundary(
        succ, ef_h, es_h, anchor, calendar
      );

      let gapHours = null;
      if (boundaryStart_h !== null) gapHours = succES_h - boundaryStart_h;
      if (boundaryFinish_h !== null && succEF_h !== undefined) {
        const finishGap = succEF_h - boundaryFinish_h;
        gapHours = gapHours === null ? finishGap : Math.min(gapHours, finishGap);
      }
      if (gapHours !== null && gapHours < freeFloatHours) {
        freeFloatHours = gapHours;
      }
    }

    // Completed tasks are history — no float, never on the critical path.
    if (isComplete) {
      totalFloatHours = 0;
      freeFloatHours = 0;
    }

    const isCritical = !isComplete && totalFloatHours <= criticalToleranceHours;

    // durationDays stays in WORKING days (the unit the duration column uses).
    const durationDays = isMilestone ? 0 : (task.duration ?? 1);

    // Milestones have ES_h === EF_h, so a boundary landing exactly on a day
    // multiple is ambiguous (see milestoneFinishTypeMap above). A finish-type
    // boundary (FF/SF/MFO/FNET) means the milestone occurs AT the end of the
    // previous working day — nudge the display lookup back by epsilon so it
    // resolves to that day instead of the next one. The stored es_h/ef_h hour
    // used by this milestone's own successors is untouched.
    const es = (isMilestone && milestoneFinishTypeMap.get(task.id))
      ? workingHoursToDate(es_h - EPSILON_HOURS, anchor, calendar)
      : startDate(es_h, anchor, calendar);
    const ef = (isMilestone && milestoneFinishTypeMap.get(task.id))
      ? es
      : finishDate(ef_h, es_h, anchor, calendar);
    const ls = startDate(ls_h, anchor, calendar);
    const lf = finishDate(lf_h, ls_h, anchor, calendar);

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
