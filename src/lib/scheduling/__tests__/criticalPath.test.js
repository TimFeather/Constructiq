import { describe, it, expect } from 'vitest';
import { runScheduleEngine } from '../scheduleEngine.js';

const CAL = { type: '5day', holidays: [], shutdowns: [] };

let idCounter = 0;
function makeTask(overrides = {}) {
  idCounter += 1;
  return {
    id: overrides.id || `t${idCounter}`,
    project_id: 'p1',
    name: overrides.name || `Task ${idCounter}`,
    parent_id: null,
    start_date: null,
    end_date: null,
    duration: 1,
    predecessors: [],
    is_milestone: false,
    percent_complete: 0,
    actual_start: null,
    actual_finish: null,
    constraint: null,
    ...overrides,
  };
}

function fs(predId, lagDays = 0) {
  return { predecessor_id: predId, type: 'FS', lag_hours: lagDays * 8, is_elapsed: false };
}

function run(tasks, projectStart = '2026-01-05', options = {}) {
  return runScheduleEngine(tasks, projectStart, CAL, options);
}

// 2026-01-05 is a Monday. No NZ holidays in early January (in the bare test calendar).

describe('FS chain', () => {
  it('schedules successors on the next working day after the predecessor finishes', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({ id: 'B', duration: 3, predecessors: [fs('A')] });
    const c = makeTask({ id: 'C', duration: 2, predecessors: [fs('B')] });
    const r = run([a, b, c]);

    expect(r.get('A').startStr).toBe('2026-01-05');
    expect(r.get('A').finishStr).toBe('2026-01-09');  // Mon–Fri, 5 working days
    expect(r.get('B').startStr).toBe('2026-01-12');   // next working day (Mon)
    expect(r.get('B').finishStr).toBe('2026-01-14');
    expect(r.get('C').startStr).toBe('2026-01-15');
    expect(r.get('C').finishStr).toBe('2026-01-16');

    // A straight chain is all-critical with zero float
    for (const id of ['A', 'B', 'C']) {
      expect(r.get(id).isCritical).toBe(true);
      expect(r.get(id).totalFloat).toBe(0);
    }
  });

  it('applies positive lag in working days', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({ id: 'B', duration: 2, predecessors: [fs('A', 2)] });
    const r = run([a, b]);
    // A finishes Fri 9th; +2wd lag = Tue 13th; next working day = Wed 14th
    expect(r.get('B').startStr).toBe('2026-01-14');
  });

  it('supports negative lag (lead time)', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({ id: 'B', duration: 3, predecessors: [fs('A', -2)] });
    const r = run([a, b]);
    // A finishes Fri 9th; -2wd = Wed 7th; +1 crossing day = Thu 8th
    expect(r.get('B').startStr).toBe('2026-01-08');
  });

  it('pulls a successor EARLIER than its stored date when the network allows (true CPM)', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({ id: 'B', duration: 2, predecessors: [fs('A')], start_date: '2026-01-20' });
    const r = run([a, b]);
    // Stored start (20th) is NOT a floor for a dependency-driven task
    expect(r.get('B').startStr).toBe('2026-01-12');
  });
});

describe('disabled dependencies', () => {
  it('is ignored by the engine: B schedules at project start, A has no successors', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({
      id: 'B', duration: 2,
      predecessors: [{ predecessor_id: 'A', type: 'FS', lag_hours: 0, is_elapsed: false, is_disabled: true }],
    });
    const r = run([a, b]);

    expect(r.get('B').startStr).toBe('2026-01-05'); // project start, not after A
    expect(r.get('B').isCritical).toBe(false);
    expect(r.get('B').freeFloat).toBeGreaterThan(0); // unconstrained by A — disabled link doesn't pin it
  });
});

describe('SS with lag', () => {
  it('offsets the successor start from the predecessor start', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({
      id: 'B', duration: 2,
      predecessors: [{ predecessor_id: 'A', type: 'SS', lag_hours: 16, is_elapsed: false }],
    });
    const r = run([a, b]);
    expect(r.get('B').startStr).toBe('2026-01-07'); // Mon + 2wd = Wed
    expect(r.get('B').finishStr).toBe('2026-01-08');
  });
});

describe('FF', () => {
  it('aligns finishes', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({
      id: 'B', duration: 2,
      predecessors: [{ predecessor_id: 'A', type: 'FF', lag_hours: 0, is_elapsed: false }],
    });
    const r = run([a, b]);
    expect(r.get('B').finishStr).toBe('2026-01-09'); // same finish as A
    expect(r.get('B').startStr).toBe('2026-01-08');  // 2wd back from Fri = Thu
  });
});

describe('SF', () => {
  it('finishes the successor the working day before the predecessor starts', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-12', duration: 3 });
    const b = makeTask({
      id: 'B', duration: 2,
      predecessors: [{ predecessor_id: 'A', type: 'SF', lag_hours: 0, is_elapsed: false }],
    });
    const r = run([a, b]);
    expect(r.get('A').startStr).toBe('2026-01-12');  // Mon
    expect(r.get('B').finishStr).toBe('2026-01-09'); // Fri before
    expect(r.get('B').startStr).toBe('2026-01-08');
  });
});

describe('diamond graph (two parallel paths merging)', () => {
  it('takes the max path and gives the short leg float', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 2 }); // Mon-Tue
    const b = makeTask({ id: 'B', duration: 5, predecessors: [fs('A')] }); // Wed 7 - Tue 13
    const c = makeTask({ id: 'C', duration: 2, predecessors: [fs('A')] }); // Wed 7 - Thu 8
    const d = makeTask({ id: 'D', duration: 1, predecessors: [fs('B'), fs('C')] });
    const r = run([a, b, c, d]);

    expect(r.get('B').finishStr).toBe('2026-01-13');
    expect(r.get('D').startStr).toBe('2026-01-14'); // driven by B, the long leg

    // Long leg critical, short leg has 3 working days of float (24h)
    expect(r.get('B').isCritical).toBe(true);
    expect(r.get('C').isCritical).toBe(false);
    expect(r.get('C').totalFloat).toBe(24);
    expect(r.get('C').freeFloat).toBe(24);
    expect(r.get('A').isCritical).toBe(true);
    expect(r.get('D').isCritical).toBe(true);
  });
});

describe('milestones', () => {
  it('schedules zero-duration milestones on the boundary day', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const m = makeTask({ id: 'M', duration: 0, is_milestone: true, predecessors: [fs('A')] });
    const r = run([a, m]);
    expect(r.get('M').startStr).toBe('2026-01-12');
    expect(r.get('M').finishStr).toBe('2026-01-12');
    expect(r.get('M').durationDays).toBe(0);
  });
});

describe('milestone finish-type links', () => {
  it('FF-linked milestone finishes on the predecessor finish day, not one day earlier', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 2 }); // Mon-Tue
    const m = makeTask({
      id: 'M', duration: 0, is_milestone: true,
      predecessors: [{ predecessor_id: 'A', type: 'FF', lag_hours: 0, is_elapsed: false }],
    });
    const r = run([a, m]);
    expect(r.get('A').finishStr).toBe('2026-01-06');
    expect(r.get('M').finishStr).toBe(r.get('A').finishStr);
  });

  it('MFO-constrained milestone with no predecessors lands exactly on the constraint date', () => {
    const m = makeTask({
      id: 'M', duration: 0, is_milestone: true,
      constraint: { type: 'MFO', date: '2026-01-14' },
    });
    const r = run([m]);
    expect(r.get('M').startStr).toBe('2026-01-14');
    expect(r.get('M').finishStr).toBe('2026-01-14');
  });
});

describe('elapsed lag (intra-day, real-clock)', () => {
  it('a 48eh lag from a Friday finish lands the successor on Monday, not Tuesday', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 }); // Mon-Fri
    const b = makeTask({
      id: 'B', duration: 2,
      predecessors: [{ predecessor_id: 'A', type: 'FS', lag_hours: 48, is_elapsed: true }],
    });
    const r = run([a, b]);
    expect(r.get('A').finishStr).toBe('2026-01-09'); // Friday
    expect(r.get('B').startStr).toBe('2026-01-12');  // Monday — not Tuesday
  });

  it('a 12eh lag from a same-day finish is not a no-op', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 0.5 }); // 4h, finishes 12:00 Mon
    const b = makeTask({
      id: 'B', duration: 0.5,
      predecessors: [{ predecessor_id: 'A', type: 'FS', lag_hours: 12, is_elapsed: true }],
    });
    const r = run([a, b]);
    // 12:00 Mon + 12eh = 00:00 Tue, snapped forward to 08:00 Tue
    expect(r.get('B').startStr).toBe('2026-01-06'); // Tuesday
  });

  it('a zero-hour elapsed lag behaves like a working lag of zero (regression)', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({
      id: 'B', duration: 2,
      predecessors: [{ predecessor_id: 'A', type: 'FS', lag_hours: 0, is_elapsed: true }],
    });
    const r = run([a, b]);
    expect(r.get('B').startStr).toBe('2026-01-12');
  });
});

describe('working-day duration output', () => {
  it('echoes stored working-day durations (never calendar spans)', () => {
    // 5-working-day task spans 7 calendar days over a weekend — durationDays
    // must stay 5 or persistence would silently inflate durations
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const r = run([a]);
    expect(r.get('A').durationDays).toBe(5);
  });
});

describe('late-finishing predecessor cascades downstream (real slip)', () => {
  it('shifts successors by exactly the right working days across weekend + holiday', () => {
    // A: Mon 29 Jun, 3d -> planned EF Wed 1 Jul. Actually finished Fri 3 Jul (2wd late).
    // B (3d) and C (2d) chained FS. Calendar holiday: Matariki Fri 10 Jul 2026.
    const cal = { type: '5day', holidays: ['2026-07-10'], shutdowns: [] };
    const a = makeTask({
      id: 'A', start_date: '2026-06-29', duration: 3,
      percent_complete: 100, actual_start: '2026-06-29', actual_finish: '2026-07-03',
    });
    const b = makeTask({ id: 'B', duration: 3, predecessors: [fs('A')] });
    const c = makeTask({ id: 'C', duration: 2, predecessors: [fs('B')] });
    const r = runScheduleEngine([a, b, c], '2026-06-29', cal);

    // A pinned to actuals
    expect(r.get('A').finishStr).toBe('2026-07-03');
    expect(r.get('A').isComplete).toBe(true);

    // B: next working day after Fri 3 Jul = Mon 6 Jul; 3wd -> Wed 8 Jul
    expect(r.get('B').startStr).toBe('2026-07-06');
    expect(r.get('B').finishStr).toBe('2026-07-08');

    // C: Thu 9 Jul; second day skips Matariki (Fri 10) + weekend -> Mon 13 Jul
    expect(r.get('C').startStr).toBe('2026-07-09');
    expect(r.get('C').finishStr).toBe('2026-07-13');
  });
});

describe('data date', () => {
  it('pushes unstarted work forward to the data date', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 3 });
    const r = run([a], '2026-01-05', { dataDate: '2026-02-02' });
    expect(r.get('A').startStr).toBe('2026-02-02'); // Mon
  });

  it('resumes remaining work of in-progress tasks at the data date', () => {
    const a = makeTask({
      id: 'A', start_date: '2026-01-05', duration: 10,
      percent_complete: 50, actual_start: '2026-01-05',
    });
    const r = run([a], '2026-01-05', { dataDate: '2026-02-02' });
    expect(r.get('A').startStr).toBe('2026-01-05');  // start stays pinned
    // 5 remaining days from Mon 2 Feb -> Fri 6 Feb
    expect(r.get('A').finishStr).toBe('2026-02-06');
  });
});

describe('completed tasks', () => {
  it('pins to actual dates with zero float and no critical flag', () => {
    const a = makeTask({
      id: 'A', start_date: '2026-01-05', duration: 5,
      percent_complete: 100, actual_start: '2026-01-06', actual_finish: '2026-01-12',
    });
    const b = makeTask({ id: 'B', duration: 1, predecessors: [fs('A')] });
    const r = run([a, b]);
    expect(r.get('A').startStr).toBe('2026-01-06');
    expect(r.get('A').finishStr).toBe('2026-01-12');
    expect(r.get('A').totalFloat).toBe(0);
    expect(r.get('A').isCritical).toBe(false);
    expect(r.get('B').startStr).toBe('2026-01-13'); // driven by the ACTUAL finish
  });
});

describe('constraint conflicts', () => {
  it('flags SNLT contradiction and produces negative float upstream', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 }); // EF Fri 9th
    const b = makeTask({
      id: 'B', duration: 2, predecessors: [fs('A')],
      constraint: { type: 'SNLT', date: '2026-01-08' }, // needs Mon 12th
    });
    const r = run([a, b]);

    expect(r.get('B').startStr).toBe('2026-01-08'); // constraint honoured
    expect(r.get('B').constraintConflict).toMatchObject({ type: 'SNLT' });
    // The predecessor now has negative float: it can't finish in time
    expect(r.get('A').totalFloat).toBeLessThan(0);
    expect(r.get('A').hasNegativeFloat).toBe(true);
  });

  it('flags MSO contradiction', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({
      id: 'B', duration: 2, predecessors: [fs('A')],
      constraint: { type: 'MSO', date: '2026-01-07' },
    });
    const r = run([a, b]);
    expect(r.get('B').startStr).toBe('2026-01-07');
    expect(r.get('B').constraintConflict).toMatchObject({ type: 'MSO' });
  });

  it('does not flag a conflict when the constraint is satisfiable', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({
      id: 'B', duration: 2, predecessors: [fs('A')],
      constraint: { type: 'SNLT', date: '2026-01-20' },
    });
    const r = run([a, b]);
    expect(r.get('B').startStr).toBe('2026-01-12');
    expect(r.get('B').constraintConflict).toBeNull();
  });
});

describe('backward-pass constraint symmetry', () => {
  it('an MSO-pinned task with no conflict shows zero float and is critical, even when unrelated work pushes project end later', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 }); // EF Fri 9th
    const b = makeTask({
      id: 'B', duration: 2, predecessors: [fs('A')],
      constraint: { type: 'MSO', date: '2026-01-20' }, // satisfiable: natural start is Mon 12th
    });
    const x = makeTask({ id: 'X', start_date: '2026-01-05', duration: 20 }); // holds project end well past B
    const r = run([a, b, x]);

    expect(r.get('B').constraintConflict).toBeNull();
    expect(r.get('B').totalFloat).toBe(0);
    expect(r.get('B').isCritical).toBe(true);
    // A gains float equal to the gap between its natural finish and B's forced later start.
    expect(r.get('A').totalFloat).toBe(48); // 6 working days (Mon 12th -> Tue 20th)
  });

  it('an SNLT-capped task does not float against a project end held out by unrelated later work', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 2 }); // EF Tue 6th
    const b = makeTask({
      id: 'B', duration: 2, predecessors: [fs('A')],
      constraint: { type: 'SNLT', date: '2026-01-08' }, // satisfiable: natural start is Wed 7th
    });
    const d = makeTask({ id: 'D', start_date: '2026-01-05', duration: 20 }); // holds project end well past B
    const r = run([a, b, d]);

    expect(r.get('B').constraintConflict).toBeNull();
    // LS capped at the SNLT date, not floated by D's unrelated slack.
    expect(r.get('B').totalFloat).toBe(8); // 1 working day (Wed 7th -> Thu 8th)
  });

  it('a completed successor does not constrain its unfinished predecessor in the backward pass', () => {
    const a = makeTask({ id: 'A', duration: 5 }); // not started, defaults to project anchor
    const b = makeTask({
      id: 'B', duration: 1, predecessors: [fs('A')],
      percent_complete: 100, actual_start: '2026-01-05', actual_finish: '2026-01-05',
    });
    const r = run([a, b]);

    // Without the fix, B's completed (and much earlier) actuals drag A's late
    // finish backward, producing bogus negative float on unfinished work.
    expect(r.get('A').totalFloat).toBe(0);
    expect(r.get('A').isCritical).toBe(true);
  });
});

describe('SNET floor constraint', () => {
  it('holds a task later than its dependency-driven date without conflict', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 2 });
    const b = makeTask({
      id: 'B', duration: 2, predecessors: [fs('A')],
      constraint: { type: 'SNET', date: '2026-01-19' },
    });
    const r = run([a, b]);
    expect(r.get('B').startStr).toBe('2026-01-19');
    expect(r.get('B').constraintConflict).toBeNull();
  });
});

describe('sub-day packing (continuous working-hour timeline)', () => {
  it('packs two consecutive 4h FS tasks into ONE calendar day', () => {
    // 0.5wd = 4h. A: 08:00–12:00 Mon; B FS after A: 13:00–17:00 SAME Mon.
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 0.5 });
    const b = makeTask({ id: 'B', duration: 0.5, predecessors: [fs('A')] });
    const r = run([a, b]);

    expect(r.get('A').startStr).toBe('2026-01-05');
    expect(r.get('A').finishStr).toBe('2026-01-05');
    expect(r.get('B').startStr).toBe('2026-01-05'); // packs, no next-day drift
    expect(r.get('B').finishStr).toBe('2026-01-05');
  });

  it('a 4h task FS-after a 12h (1.5d) task: pred finishes midday day 2, succ finishes same day', () => {
    // A: 12h from Mon 08:00 -> fills Mon (8h) + Tue morning (4h), finishes Tue 12:00.
    // B (4h) FS: starts Tue 13:00, finishes Tue 17:00 — same day as A's finish.
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 1.5 });
    const b = makeTask({ id: 'B', duration: 0.5, predecessors: [fs('A')] });
    const r = run([a, b]);

    expect(r.get('A').startStr).toBe('2026-01-05'); // Mon
    expect(r.get('A').finishStr).toBe('2026-01-06'); // Tue (midday)
    expect(r.get('B').startStr).toBe('2026-01-06'); // Tue afternoon
    expect(r.get('B').finishStr).toBe('2026-01-06'); // same day
  });

  it('a sub-day FS chain crossing a weekend and a holiday packs correctly', () => {
    // Holiday Wed 7 Jan injected. Four 4h FS tasks from Mon 5 Jan:
    //   T1: Mon AM, T2: Mon PM, T3: Tue AM, T4: Tue PM (Wed is holiday).
    const cal = { type: '5day', holidays: ['2026-01-07'], shutdowns: [] };
    const t1 = makeTask({ id: 'T1', start_date: '2026-01-05', duration: 0.5 });
    const t2 = makeTask({ id: 'T2', duration: 0.5, predecessors: [fs('T1')] });
    const t3 = makeTask({ id: 'T3', duration: 0.5, predecessors: [fs('T2')] });
    const t4 = makeTask({ id: 'T4', duration: 0.5, predecessors: [fs('T3')] });
    const r = runScheduleEngine([t1, t2, t3, t4], '2026-01-05', cal);

    expect(r.get('T1').startStr).toBe('2026-01-05'); // Mon AM
    expect(r.get('T2').startStr).toBe('2026-01-05'); // Mon PM
    expect(r.get('T3').startStr).toBe('2026-01-06'); // Tue AM
    expect(r.get('T4').startStr).toBe('2026-01-06'); // Tue PM
    expect(r.get('T4').finishStr).toBe('2026-01-06');

    // A fifth task rolls to Thu 8 (Wed 7 is a holiday, weekend not yet reached).
    const t5 = makeTask({ id: 'T5', duration: 0.5, predecessors: [fs('T4')] });
    const r2 = runScheduleEngine([t1, t2, t3, t4, t5], '2026-01-05', cal);
    expect(r2.get('T5').startStr).toBe('2026-01-08'); // Thu, skipping the holiday
  });

  it('a milestone FS-after a 4h task lands on the same day as the 4h task', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 0.5 });
    const m = makeTask({ id: 'M', duration: 0, is_milestone: true, predecessors: [fs('A')] });
    const r = run([a, m]);
    expect(r.get('A').finishStr).toBe('2026-01-05');
    expect(r.get('M').startStr).toBe('2026-01-05'); // same day, not next
    expect(r.get('M').finishStr).toBe('2026-01-05');
  });

  it('three 4h FS tasks: tasks 1+2 on day 1, task 3 on day 2 morning', () => {
    const t1 = makeTask({ id: 'T1', start_date: '2026-01-05', duration: 0.5 });
    const t2 = makeTask({ id: 'T2', duration: 0.5, predecessors: [fs('T1')] });
    const t3 = makeTask({ id: 'T3', duration: 0.5, predecessors: [fs('T2')] });
    const r = run([t1, t2, t3]);

    expect(r.get('T1').startStr).toBe('2026-01-05'); // Mon AM
    expect(r.get('T2').startStr).toBe('2026-01-05'); // Mon PM (fills the day)
    expect(r.get('T3').startStr).toBe('2026-01-06'); // Tue AM (rollover)
    expect(r.get('T3').finishStr).toBe('2026-01-06');
  });

  it('float still reports in hours; full-day-task floats match pre-change values', () => {
    // Same diamond fixture shape as above: short leg has 24h float.
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 2 });
    const b = makeTask({ id: 'B', duration: 5, predecessors: [fs('A')] });
    const c = makeTask({ id: 'C', duration: 2, predecessors: [fs('A')] });
    const d = makeTask({ id: 'D', duration: 1, predecessors: [fs('B'), fs('C')] });
    const r = run([a, b, c, d]);

    expect(r.get('C').totalFloat).toBe(24); // 3 working days × 8h, unchanged
    expect(r.get('C').freeFloat).toBe(24);
    expect(r.get('B').totalFloat).toBe(0);
    expect(r.get('A').isCritical).toBe(true);
  });
});

describe('summary rollup', () => {
  it('rolls up child dates and working-day duration', () => {
    const s = makeTask({ id: 'S', name: 'Summary' });
    const a = makeTask({ id: 'A', parent_id: 'S', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({ id: 'B', parent_id: 'S', duration: 5, predecessors: [fs('A')] });
    const r = run([s, a, b]);
    expect(r.get('S').startStr).toBe('2026-01-05');
    expect(r.get('S').finishStr).toBe('2026-01-16');
    expect(r.get('S').durationDays).toBe(10); // working days, not 12 calendar days
  });
});

describe('unplaceable predecessors (dangling ids, cycles)', () => {
  it('falls back to the stored start date when a predecessor id does not exist', () => {
    const a = makeTask({ id: 'A', start_date: '2026-01-05', duration: 5 });
    const b = makeTask({ id: 'B', duration: 2, predecessors: [fs('GHOST')], start_date: '2026-02-02' });
    const r = run([a, b]);
    // Dangling id must NOT snap B to the project anchor (2026-01-05)
    expect(r.get('B').startStr).toBe('2026-02-02');
  });

  it('keeps a persisted dependency cycle on stored dates instead of the anchor day', () => {
    // A→B→C→A cycle, stored dates consistent with the (broken) chain
    const a = makeTask({ id: 'A', duration: 1, start_date: '2026-02-02', predecessors: [fs('C')] });
    const b = makeTask({ id: 'B', duration: 1, start_date: '2026-02-03', predecessors: [fs('A')] });
    const c = makeTask({ id: 'C', duration: 1, start_date: '2026-02-04', predecessors: [fs('B')] });
    const r = run([a, b, c]);
    // No task collapses onto the project anchor day
    for (const id of ['A', 'B', 'C']) {
      expect(r.get(id).startStr).not.toBe('2026-01-05');
    }
    expect(r.get('A').startStr).toBe('2026-02-02');
    expect(r.get('B').startStr).toBe('2026-02-03');
    expect(r.get('C').startStr).toBe('2026-02-04');
  });
});

describe('ALAP does not move started work', () => {
  it('leaves a completed ALAP task pinned to its actuals', () => {
    const long = makeTask({ id: 'LONG', start_date: '2026-01-05', duration: 20 });
    const done = makeTask({
      id: 'DONE', duration: 2, constraint: { type: 'ALAP' },
      percent_complete: 100, actual_start: '2026-01-05', actual_finish: '2026-01-06',
      start_date: '2026-01-05', end_date: '2026-01-06',
    });
    const r = run([long, done]);
    expect(r.get('DONE').startStr).toBe('2026-01-05');
    expect(r.get('DONE').finishStr).toBe('2026-01-06');
  });

  it('leaves an in-progress ALAP task pinned to its actual start', () => {
    const long = makeTask({ id: 'LONG', start_date: '2026-01-05', duration: 20 });
    const wip = makeTask({
      id: 'WIP', duration: 4, constraint: { type: 'ALAP' },
      percent_complete: 50, actual_start: '2026-01-06',
      start_date: '2026-01-06', end_date: '2026-01-09',
    });
    const r = run([long, wip]);
    expect(r.get('WIP').startStr).toBe('2026-01-06');
  });
});

describe('summary tasks do not hold project end out with stale stored dates', () => {
  it('a leaf finishing after all children is critical, unheld by the summary own stale finish', () => {
    // S is a summary whose OWN stored start/duration reach into March — stale
    // from a previous run — while its children finish in January.
    const s = makeTask({ id: 'S', parent_id: null, start_date: '2026-01-05', duration: 40 });
    const c1 = makeTask({ id: 'C1', parent_id: 'S', start_date: '2026-01-05', duration: 3 });
    const c2 = makeTask({ id: 'C2', parent_id: 'S', start_date: '2026-01-12', duration: 2 });
    // Independent leaf finishing 2026-01-30 (20 working days after the Mon 5th anchor)
    const leaf = makeTask({ id: 'LEAF', start_date: '2026-01-05', duration: 20 });
    const r = run([s, c1, c2, leaf]);

    expect(r.get('LEAF').finishStr).toBe('2026-01-30');
    // Project end must be driven by LEAF, not S's stale rolled-up-from-CPM finish.
    expect(r.get('LEAF').totalFloat).toBe(0);
    expect(r.get('LEAF').isCritical).toBe(true);
  });
});

describe('summary rollup depth comes from parent_id, not wbs', () => {
  it('a grandparent summary rolls up to the grandchild span even when wbs is missing everywhere', () => {
    const g = makeTask({ id: 'G', parent_id: null, start_date: '2026-06-01', duration: 5, wbs: null });
    const p = makeTask({ id: 'P', parent_id: 'G', start_date: '2026-06-01', duration: 5, wbs: null });
    const x = makeTask({ id: 'X', parent_id: 'P', start_date: '2026-01-05', duration: 2, wbs: null });
    const y = makeTask({ id: 'Y', parent_id: 'P', start_date: '2026-01-12', duration: 3, wbs: null });
    const r = run([g, p, x, y]);

    expect(r.get('P').startStr).toBe(r.get('X').startStr);
    expect(r.get('P').finishStr).toBe(r.get('Y').finishStr);
    expect(r.get('G').startStr).toBe(r.get('X').startStr);
    expect(r.get('G').finishStr).toBe(r.get('Y').finishStr);
  });
});

describe('summary isCritical is true when it contains ANY critical child', () => {
  it('flags the summary critical even though one child has slack', () => {
    // Drives project end: an independent 10-day critical task.
    const driver = makeTask({ id: 'DRIVER', start_date: '2026-01-05', duration: 10 });
    // Matches the same finish as DRIVER -> also critical (float 0).
    const critChild = makeTask({ id: 'CRIT', parent_id: 'S', start_date: '2026-01-05', duration: 10 });
    // Finishes early -> has slack against the project end.
    const slackChild = makeTask({ id: 'SLACK', parent_id: 'S', start_date: '2026-01-05', duration: 2 });
    const s = makeTask({ id: 'S', parent_id: null, start_date: '2026-01-05', duration: 10 });
    const r = run([driver, critChild, slackChild, s]);

    expect(r.get('CRIT').isCritical).toBe(true);
    expect(r.get('SLACK').isCritical).toBe(false);
    expect(r.get('S').isCritical).toBe(true);
  });
});
