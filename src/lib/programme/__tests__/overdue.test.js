import { describe, it, expect } from 'vitest';
import { forecastLeafTasks, isOverdue, isDueBetween, localDateStr } from '../overdue.js';

const programmes = new Map([
  ['p1', { project_id: 'p1', status: 'published', calendar: { type: '5day', holidays: [], shutdowns: [] } }],
]);

// 2026-01-05 is a Monday.
const task = (over) => ({
  project_id: 'p1', parent_id: null, duration: 1, percent_complete: 0,
  actual_start: null, actual_finish: null, predecessors: [], constraint: null,
  ...over,
});

describe('forecastLeafTasks', () => {
  it('drops summary rows, so a finished phase with a stale 0% is never overdue', () => {
    const tasks = [
      task({ id: 'S', start_date: '2026-01-05', end_date: '2026-01-06', percent_complete: 0 }),
      task({ id: 'a', parent_id: 'S', start_date: '2026-01-05', end_date: '2026-01-05', percent_complete: 100, actual_start: '2026-01-05', actual_finish: '2026-01-05' }),
      task({ id: 'b', parent_id: 'S', start_date: '2026-01-06', end_date: '2026-01-06', percent_complete: 100, actual_start: '2026-01-06', actual_finish: '2026-01-06' }),
    ];
    const leaves = forecastLeafTasks(tasks, programmes);
    expect(leaves.map(t => t.id)).toEqual(['a', 'b']);
    expect(leaves.filter(t => isOverdue(t, '2026-02-01'))).toEqual([]);
  });

  it('uses the forecast finish, not a stale stored end_date', () => {
    // A finished late on Fri 16 Jan (planned 5 Jan) and was saved on a locked
    // programme, so B's stored dates were never moved. The engine pushes B to
    // Mon 19 Jan, so on Fri 16 Jan B isn't overdue yet.
    const tasks = [
      task({ id: 'A', start_date: '2026-01-05', end_date: '2026-01-05', percent_complete: 100, actual_start: '2026-01-05', actual_finish: '2026-01-16' }),
      task({ id: 'B', start_date: '2026-01-06', end_date: '2026-01-06', predecessors: [{ predecessor_id: 'A', type: 'FS', lag_hours: 0, lag_days: 0 }] }),
    ];
    const b = forecastLeafTasks(tasks, programmes).find(t => t.id === 'B');
    expect(b.end_date).toBe('2026-01-06');
    expect(b.forecast_finish).toBe('2026-01-19');
    expect(isOverdue(b, '2026-01-16')).toBe(false);
    expect(isOverdue(b, '2026-01-20')).toBe(true);
  });

  it('returns nothing for no tasks', () => {
    expect(forecastLeafTasks([], programmes)).toEqual([]);
    expect(forecastLeafTasks(undefined)).toEqual([]);
  });
});

describe('isOverdue / isDueBetween', () => {
  const t = (pct, finish) => ({ percent_complete: pct, forecast_finish: finish });

  it('is overdue only when unfinished and the finish is before today', () => {
    expect(isOverdue(t(0, '2026-01-05'), '2026-01-06')).toBe(true);
    expect(isOverdue(t(0, '2026-01-06'), '2026-01-06')).toBe(false); // due today
    expect(isOverdue(t(100, '2026-01-05'), '2026-01-06')).toBe(false);
    expect(isOverdue(t(50, null), '2026-01-06')).toBe(false);
  });

  it('is due between inclusive bounds', () => {
    expect(isDueBetween(t(0, '2026-01-06'), '2026-01-06', '2026-01-13')).toBe(true);
    expect(isDueBetween(t(0, '2026-01-13'), '2026-01-06', '2026-01-13')).toBe(true);
    expect(isDueBetween(t(0, '2026-01-14'), '2026-01-06', '2026-01-13')).toBe(false);
    expect(isDueBetween(t(100, '2026-01-07'), '2026-01-06', '2026-01-13')).toBe(false);
  });
});

describe('localDateStr', () => {
  it('formats the local calendar day, not the UTC one', () => {
    // 11:30pm local on 5 Nov is still 5 Nov locally, whatever UTC says
    expect(localDateStr(new Date(2026, 10, 5, 23, 30))).toBe('2026-11-05');
    expect(localDateStr(new Date(2026, 0, 9, 0, 5))).toBe('2026-01-09');
  });
});
