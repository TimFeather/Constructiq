// @vitest-environment jsdom
//
// Phase 7 end-to-end pass (programmatic half).
//
// Walks the whole programme-engine lifecycle against a realistic MSPDI
// fixture: import → engine dates match what MS Project computed → data date →
// late field update on a mid-chain task cascades downstream by exact working
// days across Waitangi Day 2026 → baseline variance → re-import diff →
// export → round-trip reopens clean. Persistence is mocked; the browser and
// real-MS-Project legs of Phase 7 are manual (Tim).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

vi.mock('@/api/entities', () => ({
  Task: { update: vi.fn(async () => ({})) },
  TaskChangeLog: { bulkCreate: vi.fn(async rows => rows) },
}));
vi.mock('@/api/programmeData', () => ({
  bulkUpdateSchedule: vi.fn(async patches => patches.length),
  setTaskDependencies: vi.fn(async () => 0),
}));

import { Task, TaskChangeLog } from '@/api/entities';
import { bulkUpdateSchedule } from '@/api/programmeData';
import { parseXML } from '../scheduleImportParsers.js';
import { computeImportDiff, isUpdateImport } from '../scheduleImportDiff.js';
import { buildMspdiXml } from '../scheduleExport.js';
import { runScheduleEngine, calendarForProgramme } from '../scheduling/scheduleEngine.js';
import { updateTaskProgress } from '../scheduleUpdateService.js';
import { captureBaseline, buildBaselineMap, calculateVariance } from '../scheduling/baselineEngine.js';

// A small but realistic construction programme, dated as MS Project would
// schedule it on a 5-day NZ calendar: FS chain, FS+lag, SS+lag, milestone,
// SNET anchor, and a finish that lands beyond Waitangi Day (Fri 6 Feb 2026).
const SITE_FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>12 Karamu Rd</Name>
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>12 Karamu Rd</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>1</UID><ID>1</ID><Name>Groundworks</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary>
      <Start>2026-01-19T08:00:00</Start><Finish>2026-01-28T17:00:00</Finish>
      <Duration>PT64H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
    </Task>
    <Task><UID>2</UID><ID>2</ID><Name>Site establishment</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-19T08:00:00</Start><Finish>2026-01-21T17:00:00</Finish>
      <Duration>PT24H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
      <ConstraintType>4</ConstraintType><ConstraintDate>2026-01-19T08:00:00</ConstraintDate>
    </Task>
    <Task><UID>3</UID><ID>3</ID><Name>Excavation</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-22T08:00:00</Start><Finish>2026-01-28T17:00:00</Finish>
      <Duration>PT40H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>4</UID><ID>4</ID><Name>Structure</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary>
      <Start>2026-01-30T08:00:00</Start><Finish>2026-02-10T17:00:00</Finish>
      <Duration>PT56H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
    </Task>
    <Task><UID>5</UID><ID>5</ID><Name>Pour foundations</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-30T08:00:00</Start><Finish>2026-02-03T17:00:00</Finish>
      <Duration>PT24H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>6</UID><ID>6</ID><Name>Cure and strip formwork</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-02-03T08:00:00</Start><Finish>2026-02-09T17:00:00</Finish>
      <Duration>PT32H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
      <PredecessorLink><PredecessorUID>5</PredecessorUID><Type>3</Type><LinkLag>9600</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>7</UID><ID>7</ID><Name>Ready for frame</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-02-10T08:00:00</Start><Finish>2026-02-10T08:00:00</Finish>
      <Duration>PT0H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>1</Milestone>
      <PredecessorLink><PredecessorUID>6</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
  </Tasks>
</Project>`;

/** Shape parsed MSPDI tasks into engine-shape DB rows, the way a fresh
 *  import persists them (ids assigned, parents and deps resolved to ids). */
function toDbRows(parsed) {
  const uidToId = new Map(parsed.map(pt => [pt.mspdi_uid, `t${pt.mspdi_uid}`]));
  return parsed.map((pt, i) => ({
    id: uidToId.get(pt.mspdi_uid),
    project_id: 'p1',
    mspdi_uid: pt.mspdi_uid,
    name: pt.name,
    wbs: pt.wbs,
    sort_order: i + 1,
    parent_id: pt._parentUid ? uidToId.get(pt._parentUid) : null,
    start_date: pt.start_date,
    end_date: pt.end_date,
    duration: pt.duration,
    is_milestone: !!pt.is_milestone,
    percent_complete: pt.percent_complete || 0,
    actual_start: null,
    actual_finish: null,
    constraint_data: pt.constraint_data || null,
    constraint: pt.constraint_data || null,
    predecessors: (pt._predecessorLinks || []).map(l => ({
      predecessor_id: uidToId.get(l._predUid),
      type: l.type,
      lag_hours: l.lag_hours,
      lag_days: l.lag_hours / 8,
      is_elapsed: false,
    })),
  }));
}

const PROJECT_START = '2026-01-19';
let calendar;
let tasks;

beforeAll(() => {
  // Pin the clock: "today" on site is Mon 2 Feb 2026, mid-programme.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-02T10:00:00'));
  tasks = toDbRows(parseXML(SITE_FIXTURE, 'p1'));
  calendar = calendarForProgramme(null, tasks); // generated NZ holidays incl. Waitangi Fri 6 Feb 2026
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Phase 7 E2E: import → schedule → slip → baseline → diff → export', () => {
  it('NZ calendar includes Waitangi Day 2026', () => {
    expect(calendar.holidays).toContain('2026-02-06');
  });

  it('imports the MSPDI file and the engine reproduces MS Project dates exactly', () => {
    const map = runScheduleEngine(tasks, PROJECT_START, calendar);
    const dates = id => [map.get(id).startStr, map.get(id).finishStr];

    expect(dates('t2')).toEqual(['2026-01-19', '2026-01-21']); // SNET anchor
    expect(dates('t3')).toEqual(['2026-01-22', '2026-01-28']); // FS
    expect(dates('t5')).toEqual(['2026-01-30', '2026-02-03']); // FS + 1d lag
    expect(dates('t6')).toEqual(['2026-02-03', '2026-02-09']); // SS + 2d lag, finish skips Waitangi + weekend
    expect(dates('t7')).toEqual(['2026-02-10', '2026-02-10']); // milestone
    // Summary rollups
    expect(dates('t1')).toEqual(['2026-01-19', '2026-01-28']);
    expect(dates('t4')).toEqual(['2026-01-30', '2026-02-10']);
  });

  it('data date pushes remaining work forward without moving completed tasks', () => {
    const progressed = tasks.map(t => t.id === 't2'
      ? { ...t, percent_complete: 100, actual_start: '2026-01-19', actual_finish: '2026-01-21' }
      : t);
    const map = runScheduleEngine(progressed, PROJECT_START, calendar, { dataDate: '2026-02-02' });

    // Completed task stays pinned to actuals
    expect(map.get('t2').startStr).toBe('2026-01-19');
    expect(map.get('t2').finishStr).toBe('2026-01-21');
    // Un-started downstream work cannot be scheduled before the data date
    for (const id of ['t3', 't5', 't6']) {
      expect(map.get(id).startStr >= '2026-02-02').toBe(true);
    }
  });

  it('a late field completion cascades downstream by exact working days across Waitangi Day', async () => {
    // Field save flow (Phase 6): Excavation planned to finish Wed 28 Jan is
    // completed today, Mon 2 Feb — 3 working days late.
    const baselineMap = buildBaselineMap(
      captureBaseline(tasks, runScheduleEngine(tasks, PROJECT_START, calendar))
        .map(r => ({ ...r, baseline_id: 'bl1' }))
    );

    const { patches, scheduledMap } = await updateTaskProgress('t3', 100, tasks, {
      userId: 'user-1', projectStart: PROJECT_START, calendar, dataDate: null,
    });

    // Direct edit persisted with actuals; real slip triggered a cascade
    expect(Task.update).toHaveBeenCalledWith('t3', expect.objectContaining({
      percent_complete: 100,
      actual_start: '2026-01-22',
      actual_finish: '2026-02-02',
    }));
    expect(bulkUpdateSchedule).toHaveBeenCalledTimes(1);

    // Pour foundations: FS + 1d lag from Mon 2 Feb → lag burns Tue 3, starts
    // Wed 4 Feb; 3 working days = Wed, Thu, then over Waitangi (Fri 6) and
    // the weekend to finish Mon 9 Feb.
    const t5 = patches.find(p => p.id === 't5');
    expect([t5.start_date, t5.end_date]).toEqual(['2026-02-04', '2026-02-09']);

    // Cure and strip: SS + 2d lag from the new pour start (Wed 4 Feb) →
    // Thu 5, then Mon 9 (Waitangi + weekend skipped); 4d → finish Thu 12.
    const t6 = patches.find(p => p.id === 't6');
    expect([t6.start_date, t6.end_date]).toEqual(['2026-02-09', '2026-02-12']);

    // Milestone follows to Fri 13 Feb.
    expect(scheduledMap.get('t7').startStr).toBe('2026-02-13');

    // Audit trail: cascaded rows point back at the field-updated task.
    const rows = TaskChangeLog.bulkCreate.mock.calls[0][0];
    expect(rows.some(r => r.task_id === 't3' && r.changed_by === 'user-1')).toBe(true);
    expect(rows.some(r => r.task_id === 't5' && r.changed_by === null && r.trigger_task_id === 't3')).toBe(true);

    // Baseline captured before the slip shows the variance.
    const variance = calculateVariance(baselineMap.get('t5'), scheduledMap.get('t5'));
    expect(variance.finishVariance).toBe(6); // 3 Feb → 9 Feb
    expect(variance.status).toBe('Delayed 6d');
  });

  it('never writes the legacy JSONB predecessors column', async () => {
    await updateTaskProgress('t3', 100, tasks, {
      userId: 'user-1', projectStart: PROJECT_START, calendar, dataDate: null,
    });
    for (const [, payload] of Task.update.mock.calls) {
      expect(payload).not.toHaveProperty('predecessors');
    }
    for (const [patches] of bulkUpdateSchedule.mock.calls) {
      for (const p of patches) {
        expect(Object.keys(p).sort()).toEqual(['duration', 'end_date', 'id', 'start_date']);
      }
    }
  });

  it('re-importing an updated file classifies added and changed tasks for review', () => {
    expect(isUpdateImport(tasks)).toBe(true);

    // Consultant issues a revised programme: cure extended to 5d, new drainage task.
    const revised = SITE_FIXTURE
      .replace('<Duration>PT32H0M0S</Duration>', '<Duration>PT40H0M0S</Duration>')
      .replace('</Tasks>', `
    <Task><UID>8</UID><ID>8</ID><Name>Drainage</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-02-10T08:00:00</Start><Finish>2026-02-12T17:00:00</Finish>
      <Duration>PT24H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
      <PredecessorLink><PredecessorUID>6</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
  </Tasks>`);

    const diff = computeImportDiff(parseXML(revised, 'p1'), tasks);
    expect(diff.added.map(t => t.mspdi_uid)).toEqual([8]);
    expect(diff.missing).toHaveLength(0);
    const changed6 = diff.changed.find(c => c.existing.id === 't6');
    expect(changed6.fieldDiffs.some(d => d.field === 'duration')).toBe(true);
  });

  it('export → re-import round-trip reopens clean (no diff)', () => {
    const xml = buildMspdiXml(tasks, null, { projectName: '12 Karamu Rd', holidays: calendar.holidays });
    const reparsed = parseXML(xml, 'p1');
    expect(reparsed).toHaveLength(tasks.length);

    // The re-parse must land on the very rows we exported: uids preserved,
    // so diffing against the current DB shows no changes at all.
    const diff = computeImportDiff(reparsed, tasks);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.missing).toHaveLength(0);
    expect(diff.unchangedCount).toBe(tasks.length);
  });
});
