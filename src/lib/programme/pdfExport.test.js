// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { addDays, format } from 'date-fns';
import { buildProgrammePdfDoc, exportProgrammePdf, programmePdfBase64 } from './pdfExport';
import { getVisibleTasks } from './visibleTasks';

function buildScenario({ n = 60, spanDays = 500, base = '2026-01-05' } = {}) {
  const start0 = new Date(`${base}T00:00:00`);
  const tasks = [];
  const scheduledMap = new Map();
  const baselineMap = new Map();

  // one parent summary + n children with a chain of FS/SS/FF/SF deps
  tasks.push({ id: 'p1', name: 'Phase 1', parent_id: null, duration: spanDays, is_milestone: false, percent_complete: 40, wbs: '1', sort_order: 0 });
  for (let i = 0; i < n; i++) {
    const start = addDays(start0, Math.floor((i / n) * spanDays));
    const dur = i % 7 === 0 ? 0 : 3 + (i % 5);
    const finish = addDays(start, Math.max(0, dur - 1));
    const id = `t${i}`;
    tasks.push({
      id,
      name: `Task ${i}`,
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
      durationDays: dur,
      startStr: format(start, 'yyyy-MM-dd'),
      finishStr: format(finish, 'yyyy-MM-dd'),
    });
    if (i % 5 === 0) {
      baselineMap.set(id, { baseline_start: addDays(start, -2).toISOString(), baseline_finish: addDays(finish, 1).toISOString() });
    }
  }
  scheduledMap.set('p1', {
    start: start0, finish: addDays(start0, spanDays - 1), isCritical: false, totalFloat: 0, rolledProgress: 42, durationDays: 123,
  });

  return { tasks, scheduledMap, programme: { data_date: '2026-06-01' }, projectName: 'Smoke Test Project', baselineMap };
}

// jsPDF keeps each page's content stream uncompressed in memory.
const pageStreams = (doc) => doc.internal.pages.slice(1).map(ops => ops.join('\n'));
const drawnStrings = (doc) => pageStreams(doc).flatMap(s => [...s.matchAll(/\((.*?)\) Tj/g)].map(m => m[1]));
const CRITICAL_RED = /0\.9 0\.27 0\.27 rg/; // RGB.critical fill

describe('buildProgrammePdfDoc', () => {
  it('builds every timescale tier, on A4 and A3', () => {
    for (const spanDays of [10, 60, 300, 1500]) {
      for (const paper of ['a4', 'a3']) {
        expect(buildProgrammePdfDoc({ ...buildScenario({ n: 40, spanDays }), paper })).not.toBeNull();
      }
    }
  });

  it('fits the timeline to the page width: pages only break downwards, no task printed twice', () => {
    for (const spanDays of [60, 300, 1500]) {
      const scenario = buildScenario({ n: 80, spanDays });
      const doc = buildProgrammePdfDoc(scenario);
      const rowsPerPage = 31; // A4 landscape
      expect(doc.getNumberOfPages()).toBe(Math.ceil(81 / rowsPerPage));
      const strings = drawnStrings(doc);
      for (const t of scenario.tasks) {
        expect(strings.filter(s => s === t.wbs)).toHaveLength(1);
      }
    }
  });

  it('A3 fits more rows per page than A4', () => {
    const scenario = buildScenario({ n: 80, spanDays: 300 });
    expect(buildProgrammePdfDoc({ ...scenario, paper: 'a3' }).getNumberOfPages())
      .toBeLessThan(buildProgrammePdfDoc(scenario).getNumberOfPages());
  });

  it('never wraps a timescale label (jsPDF stacks wrapped words down over the rows)', () => {
    // A 2 March start pads back into February, leaving a sliver of a month at the left edge.
    for (const spanDays of [10, 40, 120, 270, 380, 800]) {
      const doc = buildProgrammePdfDoc(buildScenario({ n: 30, spanDays, base: '2026-03-02' }));
      for (const stream of pageStreams(doc)) expect(stream).not.toMatch(/T\*/);
    }
  });

  it('prints only the rows it is given, so collapsed groups print collapsed', () => {
    const scenario = buildScenario({ n: 20, spanDays: 60 });
    const doc = buildProgrammePdfDoc({ ...scenario, visibleTasks: getVisibleTasks(scenario.tasks, new Set()) });
    const strings = drawnStrings(doc);
    expect(strings).toContain('Phase 1');
    expect(strings).not.toContain('Task 1');
  });

  it('defaults to every task, expanded', () => {
    const scenario = buildScenario({ n: 20, spanDays: 60 });
    const strings = drawnStrings(buildProgrammePdfDoc(scenario));
    for (const t of scenario.tasks) expect(strings).toContain(t.name);
  });

  it('critical tasks go red only when highlighted, and highlighting keeps every row', () => {
    const scenario = buildScenario({ n: 40, spanDays: 200 });
    const plain = buildProgrammePdfDoc(scenario);
    const highlighted = buildProgrammePdfDoc({ ...scenario, highlightCritical: true });
    expect(pageStreams(plain).join('\n')).not.toMatch(CRITICAL_RED);
    expect(pageStreams(highlighted).join('\n')).toMatch(CRITICAL_RED);
    const strings = drawnStrings(highlighted);
    for (const t of scenario.tasks) expect(strings).toContain(t.name);
  });

  it('summary duration is the engine roll-up, as in the task list', () => {
    expect(drawnStrings(buildProgrammePdfDoc(buildScenario({ n: 10, spanDays: 30 })))).toContain('123d');
  });

  it('milestones and missing baseline/scheduledMap entries do not throw', () => {
    const scenario = buildScenario({ n: 15, spanDays: 60 });
    scenario.scheduledMap.delete('t3'); // task with no resolved schedule
    expect(buildProgrammePdfDoc(scenario)).not.toBeNull();
  });

  it('empty task list draws nothing', () => {
    expect(buildProgrammePdfDoc({ tasks: [], scheduledMap: new Map() })).toBeNull();
    expect(exportProgrammePdf({ tasks: [], scheduledMap: new Map() })).toBe(false);
  });
});

describe('programmePdfBase64', () => {
  it('returns raw base64 PDF bytes across the timescale tiers', () => {
    for (const opts of [{ n: 10, spanDays: 20 }, { n: 80, spanDays: 300 }, { n: 200, spanDays: 1500 }]) {
      const out = programmePdfBase64(buildScenario(opts));
      expect(out).not.toBeNull();
      expect(out.base64.startsWith('JVBER')).toBe(true);   // base64 of '%PDF'
      expect(out.base64).not.toMatch(/^data:/);            // guards the datauristring trap
      expect(out.bytes).toBeGreaterThan(1000);
      expect(out.base64.length).toBeLessThan(8 * 1024 * 1024);
      expect(out.filename).toMatch(/^Smoke Test Project - Programme \d{4}-\d{2}-\d{2}\.pdf$/);
    }
  });

  it('returns null for an empty task list', () => {
    expect(programmePdfBase64({ tasks: [], scheduledMap: new Map() })).toBeNull();
  });

  it('builds the A3 landscape sheet the publish email attaches', () => {
    const pdf = atob(programmePdfBase64({ ...buildScenario({ n: 40, spanDays: 200 }), paper: 'a3' }).base64);
    const [w, h] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf).slice(1).map(Number);
    expect([Math.round(w), Math.round(h)]).toEqual([1191, 842]); // A3 landscape, in points
  });
});
