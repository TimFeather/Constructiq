/**
 * ConstructIQ Scheduling Engine
 * MS Project-compatible forward-pass scheduler
 *
 * Supports:
 * - FS, SS, FF, SF dependency types
 * - Positive lag / negative lead (hours)
 * - Calendar-aware lag (skips weekends) vs elapsed lag (raw 24/7)
 * - Summary task rollup (read-only: min start / max finish of children)
 * - ASAP, ALAP, MSO, FNLT constraints
 * - Cycle detection (DFS) before any link is created
 */

const WORK_HOURS_PER_DAY = 8;
const WORK_START_HOUR = 8; // 08:00

// ─── Calendar helpers ────────────────────────────────────────────────────────

/** Is the given Date a working day (Mon-Fri)? */
function isWorkday(date) {
  const dow = date.getDay();
  return dow !== 0 && dow !== 6;
}

/**
 * Add `hours` of calendar-aware working time to `startDate`.
 * Positive = lag forward; negative = lead backward.
 */
function addWorkingHours(startDate, hours) {
  if (hours === 0) return new Date(startDate);
  const date = new Date(startDate);
  const sign = hours > 0 ? 1 : -1;
  let remaining = Math.abs(hours);

  while (remaining > 0) {
    date.setDate(date.getDate() + sign);
    if (isWorkday(date)) {
      remaining -= Math.min(remaining, WORK_HOURS_PER_DAY);
    }
  }
  return date;
}

/**
 * Add `hours` of elapsed (24/7) time to `startDate`.
 */
function addElapsedHours(startDate, hours) {
  const ms = hours * 60 * 60 * 1000;
  return new Date(new Date(startDate).getTime() + ms);
}

/** Add lag (working or elapsed) and return new Date */
function applyLag(date, lagHours, isElapsed) {
  if (!lagHours) return new Date(date);
  return isElapsed ? addElapsedHours(date, lagHours) : addWorkingHours(date, lagHours);
}

/** Snap a date to midnight (start of day) */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Format date to yyyy-MM-dd */
function toDateStr(date) {
  if (!date) return null;
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

/** Parse a yyyy-MM-dd string to a Date at midnight */
function parseDate(str) {
  if (!str) return null;
  return new Date(str + 'T00:00:00');
}

/** Duration in hours → working days (ceiling) */
function hoursToDays(hours) {
  return Math.max(1, Math.ceil(hours / WORK_HOURS_PER_DAY));
}

/** Duration in calendar days → hours */
function daysToHours(days) {
  return (days || 1) * WORK_HOURS_PER_DAY;
}

// ─── Cycle Detection ──────────────────────────────────────────────────────────

/**
 * Run DFS cycle detection on the task list.
 * Returns true if adding edge fromId → toId would create a cycle.
 * @param {Array} tasks
 * @param {string} fromId - predecessor being added
 * @param {string} toId - successor being added
 */
export function wouldCreateCycle(tasks, fromId, toId) {
  // Build adjacency list (successor → [predecessors])
  const graph = new Map(tasks.map(t => [t.id, []]));

  tasks.forEach(t => {
    (t.predecessors || []).forEach(p => {
      if (graph.has(t.id)) graph.get(t.id).push(p.predecessor_id || p.task_id);
    });
  });

  // Temporarily add the new edge
  if (!graph.has(toId)) graph.set(toId, []);
  graph.get(toId).push(fromId);

  // DFS: can we reach fromId starting from fromId via successors?
  // (i.e., does fromId appear as an ancestor of itself?)
  const visited = new Set();
  const stack = [fromId];

  // Build forward (successor) graph for reachability
  const forward = new Map(tasks.map(t => [t.id, []]));
  tasks.forEach(t => {
    (t.predecessors || []).forEach(p => {
      const pid = p.predecessor_id || p.task_id;
      if (!forward.has(pid)) forward.set(pid, []);
      forward.get(pid).push(t.id);
    });
  });
  // Add the proposed new edge: fromId → toId
  if (!forward.has(fromId)) forward.set(fromId, []);
  forward.get(fromId).push(toId);

  // DFS from toId — if we reach fromId, it's a cycle
  const seen = new Set();
  const dfsStack = [toId];
  while (dfsStack.length) {
    const node = dfsStack.pop();
    if (node === fromId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    (forward.get(node) || []).forEach(s => dfsStack.push(s));
  }
  return false;
}

// ─── Topological Sort ─────────────────────────────────────────────────────────

/**
 * Kahn's algorithm — returns tasks in topological order.
 * Tasks with no predecessors come first.
 */
function topoSort(tasks) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const inDegree = new Map(tasks.map(t => [t.id, 0]));
  const successors = new Map(tasks.map(t => [t.id, []]));

  tasks.forEach(t => {
    (t.predecessors || []).forEach(p => {
      const pid = p.predecessor_id || p.task_id;
      if (taskMap.has(pid)) {
        inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
        if (!successors.has(pid)) successors.set(pid, []);
        successors.get(pid).push(t.id);
      }
    });
  });

  const queue = tasks.filter(t => (inDegree.get(t.id) || 0) === 0).map(t => t.id);
  const sorted = [];

  while (queue.length) {
    const id = queue.shift();
    const t = taskMap.get(id);
    if (t) sorted.push(t);
    (successors.get(id) || []).forEach(sid => {
      const deg = (inDegree.get(sid) || 1) - 1;
      inDegree.set(sid, deg);
      if (deg === 0) queue.push(sid);
    });
  }

  // Append any remaining (cyclic or orphaned — shouldn't happen after cycle check)
  tasks.forEach(t => { if (!sorted.find(s => s.id === t.id)) sorted.push(t); });
  return sorted;
}

// ─── Forward Pass ─────────────────────────────────────────────────────────────

/**
 * Apply the dependency boundary constraints for a given dependency type.
 * Returns the earliest allowable start date for the successor.
 *
 * @param {Object} dep - { predecessor_id|task_id, type, lag_hours, is_elapsed }
 * @param {Object} predResolved - { start: Date, finish: Date }
 * @param {Date} currentStart - current early start of successor
 * @param {Date} currentFinish - current early finish of successor
 * @param {number} durationHours - successor duration in hours
 * @returns {{ newStart: Date, newFinish: Date }}
 */
function applyDependencyConstraint(dep, predResolved, currentStart, currentFinish, durationHours) {
  const type = dep.type || 'FS';
  const lagHours = dep.lag_hours ?? (dep.lag_days != null ? dep.lag_days * WORK_HOURS_PER_DAY : 0);
  const isElapsed = dep.is_elapsed || false;

  let newStart = new Date(currentStart);
  let newFinish = new Date(currentFinish);

  switch (type) {
    case 'FS': {
      // Successor Start ≥ Predecessor Finish + Lag
      const boundary = applyLag(predResolved.finish, lagHours, isElapsed);
      if (boundary > newStart) {
        newStart = startOfDay(boundary);
        newFinish = addWorkingHours(newStart, durationHours - WORK_HOURS_PER_DAY);
        newFinish = startOfDay(addWorkingHours(newStart, durationHours > WORK_HOURS_PER_DAY ? durationHours - WORK_HOURS_PER_DAY : 0));
      }
      break;
    }
    case 'SS': {
      // Successor Start ≥ Predecessor Start + Lag
      const boundary = applyLag(predResolved.start, lagHours, isElapsed);
      if (boundary > newStart) {
        newStart = startOfDay(boundary);
        newFinish = startOfDay(addWorkingHours(newStart, durationHours > WORK_HOURS_PER_DAY ? durationHours - WORK_HOURS_PER_DAY : 0));
      }
      break;
    }
    case 'FF': {
      // Successor Finish ≥ Predecessor Finish + Lag
      const boundary = applyLag(predResolved.finish, lagHours, isElapsed);
      if (boundary > newFinish) {
        newFinish = startOfDay(boundary);
        newStart = startOfDay(addWorkingHours(newFinish, -(durationHours > WORK_HOURS_PER_DAY ? durationHours - WORK_HOURS_PER_DAY : 0)));
      }
      break;
    }
    case 'SF': {
      // Successor Finish ≥ Predecessor Start + Lag
      const boundary = applyLag(predResolved.start, lagHours, isElapsed);
      if (boundary > newFinish) {
        newFinish = startOfDay(boundary);
        newStart = startOfDay(addWorkingHours(newFinish, -(durationHours > WORK_HOURS_PER_DAY ? durationHours - WORK_HOURS_PER_DAY : 0)));
      }
      break;
    }
    default:
      break;
  }

  return { newStart, newFinish };
}

// ─── Summary Rollup ───────────────────────────────────────────────────────────

function rollupSummaryTasks(tasks, resolvedMap) {
  // Process in reverse WBS order so children are resolved before parents
  const summaryTasks = tasks.filter(t => t.is_summary || t.level === 0 || t.level === 1);

  summaryTasks.forEach(summary => {
    const children = tasks.filter(t => t.parent_id === summary.id);
    if (children.length === 0) return;

    const childStarts = children.map(c => resolvedMap.get(c.id)?.start).filter(Boolean);
    const childFinishes = children.map(c => resolvedMap.get(c.id)?.finish).filter(Boolean);

    if (childStarts.length === 0) return;

    const minStart = new Date(Math.min(...childStarts.map(d => d.getTime())));
    const maxFinish = new Date(Math.max(...childFinishes.map(d => d.getTime())));

    resolvedMap.set(summary.id, { start: minStart, finish: maxFinish });
  });
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

/**
 * Run the full forward-pass scheduling engine on all tasks.
 *
 * @param {Array} tasks - raw task objects from the database
 * @param {string} projectStartDate - fallback ASAP start (yyyy-MM-dd)
 * @returns {Map<string, { start: Date, finish: Date, startStr: string, finishStr: string, durationDays: number }>}
 */
export function runScheduleEngine(tasks, projectStartDate) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const resolvedMap = new Map(); // id → { start, finish }

  const fallbackStart = parseDate(projectStartDate) || new Date();

  // Process tasks in topological order
  const sorted = topoSort(tasks);

  sorted.forEach(task => {
    // Summary tasks get rolled up after children are resolved
    const isSummary = task.is_summary || task.level === 0 || task.level === 1;

    const durationHours = task.duration_hours || daysToHours(task.duration || 1);

    // Determine constraint-based early start
    let earlyStart;
    const constraint = task.constraint || { type: 'ASAP', date: null };

    switch (constraint.type) {
      case 'MSO': // Must Start On
        earlyStart = parseDate(constraint.date) || parseDate(task.start_date) || fallbackStart;
        break;
      case 'FNLT': // Finish No Later Than — we honour start as given
        earlyStart = parseDate(task.start_date) || fallbackStart;
        break;
      case 'ALAP': // As Late As Possible — use stored date for now
        earlyStart = parseDate(task.start_date) || fallbackStart;
        break;
      case 'SNET': // Start No Earlier Than — enforce minimum start date
        earlyStart = parseDate(constraint.date) || parseDate(task.start_date) || fallbackStart;
        break;
      case 'SNLT': // Start No Later Than — use stored start as initial
        earlyStart = parseDate(task.start_date) || fallbackStart;
        break;
      case 'FNET': // Finish No Earlier Than
        earlyStart = parseDate(task.start_date) || fallbackStart;
        break;
      case 'ASAP':
      default:
        earlyStart = parseDate(task.start_date) || fallbackStart;
        break;
    }

    let earlyFinish = addWorkingHours(earlyStart, Math.max(durationHours - WORK_HOURS_PER_DAY, 0));
    earlyFinish = startOfDay(earlyFinish);

    // Apply each predecessor dependency constraint
    (task.predecessors || []).forEach(dep => {
      const pid = dep.predecessor_id || dep.task_id;
      const predResolved = resolvedMap.get(pid);
      if (!predResolved) return; // predecessor not yet resolved (shouldn't happen post-topo-sort)

      const result = applyDependencyConstraint(dep, predResolved, earlyStart, earlyFinish, durationHours);
      if (result.newStart > earlyStart) {
        earlyStart = result.newStart;
        earlyFinish = result.newFinish;
      }
    });

    // For MSO, enforce the hard constraint even if predecessors push later
    if (constraint.type === 'MSO' && constraint.date) {
      const msoDate = parseDate(constraint.date);
      if (msoDate > earlyStart) {
        earlyStart = msoDate;
        earlyFinish = addWorkingHours(earlyStart, Math.max(durationHours - WORK_HOURS_PER_DAY, 0));
      }
    }

    // For SNET, enforce minimum start date — predecessors CAN push it later but not earlier
    if (constraint.type === 'SNET' && constraint.date) {
      const snetDate = parseDate(constraint.date);
      if (snetDate > earlyStart) {
        earlyStart = snetDate;
        earlyFinish = addWorkingHours(earlyStart, Math.max(durationHours - WORK_HOURS_PER_DAY, 0));
      }
    }

    // Ensure start is a workday
    while (!isWorkday(earlyStart)) {
      earlyStart = addWorkingHours(earlyStart, WORK_HOURS_PER_DAY);
    }

    resolvedMap.set(task.id, { start: earlyStart, finish: earlyFinish });
  });

  // Rollup summary tasks (overwrite with min/max of children)
  rollupSummaryTasks(tasks, resolvedMap);

  // Build output with string dates and day counts
  const output = new Map();
  resolvedMap.forEach((resolved, id) => {
    const task = taskMap.get(id);
    const durationHours = task?.duration_hours || daysToHours(task?.duration || 1);
    const durationDays = Math.max(1, Math.round(
      (resolved.finish.getTime() - resolved.start.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1);

    output.set(id, {
      start: resolved.start,
      finish: resolved.finish,
      startStr: toDateStr(resolved.start),
      finishStr: toDateStr(resolved.finish),
      durationDays,
    });
  });

  return output;
}

/**
 * Given a changed task, compute which tasks need updating and return
 * an array of { id, start_date, end_date, duration } patches.
 *
 * @param {string} changedTaskId
 * @param {Array} allTasks - full task list with the updated task already merged in
 * @param {string} projectStartDate
 * @returns {Array<{ id, start_date, end_date, duration }>}
 */
export function computeCascade(changedTaskId, allTasks, projectStartDate) {
  const scheduled = runScheduleEngine(allTasks, projectStartDate);
  const patches = [];

  allTasks.forEach(task => {
    const resolved = scheduled.get(task.id);
    if (!resolved) return;
    const newStart = resolved.startStr;
    const newEnd = resolved.finishStr;
    const newDur = resolved.durationDays;

    // Only emit a patch if dates actually changed
    if (newStart !== task.start_date || newEnd !== task.end_date || newDur !== task.duration) {
      patches.push({ id: task.id, start_date: newStart, end_date: newEnd, duration: newDur });
    }
  });

  return patches;
}