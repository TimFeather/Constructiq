// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { addDays, format } from 'date-fns';
import { exportProgrammePdf } from './pdfExport';

function buildScenario({ n = 60, spanDays = 500 } = {}) {
  const base = new Date('2026-01-05T00:00:00');
  const tasks = [];
  const scheduledMap = new Map();
  const baselineMap = new Map();

  // one parent summary + n children with a chain of FS/SS/FF/SF deps
  tasks.push({ id: 'p1', name: 'Phase 1', parent_id: null, duration: spanDays, is_milestone: false, percent_complete: 40, sort_order: 0 });
  for (let i = 0; i < n; i++) {
    const start = addDays(base, Math.floor((i / n) * spanDays));
    const dur = i % 7 === 0 ? 0 : 3 + (i % 5);
    const finish = addDays(start, Math.max(0, dur - 1));
    const id = `t${i}`;
    tasks.push({
      id,
      name: `Task ${i} - ${'x'.repeat(i % 20)}`,
      parent_id: 'p1',
      duration: dur,
      is_milestone: dur === 0,
      percent_complete: (i * 7) % 100,
      wbs: `1.${i + 1}`,
      predecessors: i > 0 ? [{ predecessor_id: `t${i - 1}`, type: ['FS', 'SS', 'FF', 'SF'][i % 4], lag_days: i % 3 }] : [],
      sort_order: i + 1,
    });
    scheduledMap.set(id, {
      start, finish,
      isCritical: i % 4 === 0,
      totalFloat: (i % 6) * 8,
      startStr: format(start, 'yyyy-MM-dd'),
      finishStr: format(finish, 'yyyy-MM-dd'),
    });
    if (i % 5 === 0) {
      baselineMap.set(id, { baseline_start: addDays(start, -2).toISOString(), baseline_finish: addDays(finish, 1).toISOString() });
    }
  }
  scheduledMap.set('p1', {
    start: base, finish: addDays(base, spanDays - 1), isCritical: false, totalFloat: 0, rolledProgress: 42,
  });

  return { tasks, scheduledMap, programme: { data_date: '2026-06-01' }, projectName: 'Smoke Test Project', baselineMap };
}

// jsPDF's doc.save() calls file-saver, which needs `document` — absent in the
// node test environment. That's expected here; we only care that every
// drawing/geometry call before save() succeeds without throwing.
function runExport(args) {
  try {
    exportProgrammePdf(args);
  } catch (err) {
    if (/document is not defined/i.test(err.message)) return;
    throw err;
  }
}

describe('exportProgrammePdf smoke tests', () => {
  it('short single-page schedule (week tier)', () => {
    const scenario = buildScenario({ n: 10, spanDays: 20 });
    expect(() => runExport(scenario)).not.toThrow();
  });

  it('medium multi-page schedule (month tier)', () => {
    const scenario = buildScenario({ n: 80, spanDays: 300 });
    expect(() => runExport(scenario)).not.toThrow();
  });

  it('long multi-year schedule (year tier) with many rows (row+date tiling)', () => {
    const scenario = buildScenario({ n: 200, spanDays: 1500 });
    expect(() => runExport(scenario)).not.toThrow();
  });

  it('criticalOnly filter', () => {
    const scenario = buildScenario({ n: 40, spanDays: 200 });
    expect(() => runExport({ ...scenario, criticalOnly: true })).not.toThrow();
  });

  it('empty task list is a no-op', () => {
    expect(exportProgrammePdf({ tasks: [], scheduledMap: new Map() })).toBe(false);
  });

  it('milestones and missing baseline/scheduledMap entries do not throw', () => {
    const scenario = buildScenario({ n: 15, spanDays: 60 });
    scenario.scheduledMap.delete('t3'); // task with no resolved schedule
    expect(() => runExport(scenario)).not.toThrow();
  });
});
