// "Need more time?" from the Look Ahead update sheet: adding working days to
// a task, previewing the new finish, and saving it with the % update in one
// engine run. Persistence is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/entities', () => ({
  Task: { update: vi.fn(async () => ({})) },
  TaskChangeLog: { bulkCreate: vi.fn(async rows => rows) },
}));
vi.mock('@/api/programmeData', () => ({
  bulkUpdateSchedule: vi.fn(async patches => patches.length),
  setTaskDependencies: vi.fn(async () => 0),
}));

import { Task } from '@/api/entities';
import { bulkUpdateSchedule } from '@/api/programmeData';
import { normalizeDuration } from '../scheduling/duration.js';
import { runScheduleEngine } from '../scheduling/scheduleEngine.js';
import { DEFAULT_CALENDAR, countWorkingDays, parseDate } from '../scheduling/calendarEngine.js';
import {
  extendedDuration, fieldUpdateChanges, previewFieldUpdate, extendTask, updateTaskDuration,
} from '../scheduleUpdateService.js';

const fs = (id) => ({ predecessor_id: id, type: 'FS', lag_days: 0 });
const task = (over) => ({
  project_id: 'p1', parent_id: null, percent_complete: 0, predecessors: [], constraint: null, ...over,
});

// Mon 2 Nov 2026: Frame (4d) → Clad (3d) → Paint (2d), plain 5-day calendar
const programme = () => [
  task({ id: 'frame', name: 'Frame', start_date: '2026-11-02', end_date: '2026-11-05', duration: 4 }),
  task({ id: 'clad', name: 'Clad', start_date: '2026-11-06', end_date: '2026-11-10', duration: 3, predecessors: [fs('frame')] }),
  task({ id: 'paint', name: 'Paint', start_date: '2026-11-11', end_date: '2026-11-12', duration: 2, predecessors: [fs('clad')] }),
];
const options = (over = {}) => ({ projectStart: '2026-11-02', calendar: DEFAULT_CALENDAR, dataDate: null, ...over });

/** Working days from one finish to another (+ later, − earlier). */
const slip = (from, to) => (to >= from
  ? countWorkingDays(parseDate(from), parseDate(to), DEFAULT_CALENDAR)
  : -countWorkingDays(parseDate(to), parseDate(from), DEFAULT_CALENDAR));

describe('normalizeDuration', () => {
  it('keeps half and quarter days instead of rounding to whole days', () => {
    expect(normalizeDuration('2.5')).toBe(2.5);
    expect(normalizeDuration(0.25)).toBe(0.25);
    expect(normalizeDuration('1.333')).toBe(1.33);
  });

  it('falls back for zero, negative or junk input', () => {
    expect(normalizeDuration(0)).toBe(1);
    expect(normalizeDuration(-2)).toBe(1);
    expect(normalizeDuration('abc', null)).toBeNull();
  });

  it('updateTaskDuration no longer forces half-day tasks up to 1 day', async () => {
    const { mergedTasks } = await updateTaskDuration('frame', 0.5, programme(), options());
    expect(mergedTasks.find(t => t.id === 'frame').duration).toBe(0.5);
  });
});

describe('extendedDuration', () => {
  it('adds the days straight onto the duration when no data date is set', () => {
    const frame = programme()[0];
    expect(extendedDuration(frame, 2)).toBe(6);
    expect(extendedDuration(frame, 0.5)).toBe(4.5);
    expect(extendedDuration({ ...frame, percent_complete: 50 }, 2)).toBe(6);
  });

  it('with a data date, moves an in-progress task\'s finish by exactly the days added', () => {
    const dataDate = '2026-11-04';
    for (const percent of [5, 25, 35, 50, 70, 90, 95]) {
      for (const duration of [1, 2.5, 4, 7, 10]) {
        for (const extra of [1, 2, 5]) {
          const tasks = programme().map(t => (t.id === 'frame'
            ? { ...t, duration, percent_complete: percent, actual_start: '2026-11-02' }
            : t));
          const before = runScheduleEngine(tasks, '2026-11-02', DEFAULT_CALENDAR, { dataDate }).get('frame').finishStr;
          const next = extendedDuration(tasks[0], extra, { percent, dataDate });
          const after = runScheduleEngine(
            tasks.map(t => (t.id === 'frame' ? { ...t, duration: next } : t)), '2026-11-02', DEFAULT_CALENDAR, { dataDate },
          ).get('frame').finishStr;
          expect([percent, duration, extra, slip(before, after)]).toEqual([percent, duration, extra, extra]);
        }
      }
    }
  });
});

describe('fieldUpdateChanges', () => {
  it('backfills the actual start with the % and adds the longer duration', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T10:00:00'));
    try {
      const frame = programme()[0];
      const changes = fieldUpdateChanges(frame, { percent_complete: 50, extraDays: 2 });
      expect(changes.percent_complete).toBe(50);
      expect(changes.actual_start).toBe('2026-11-02'); // started as planned
      expect(changes.duration).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the duration alone when no days are added', () => {
    expect(fieldUpdateChanges(programme()[0], { percent_complete: 25 })).not.toHaveProperty('duration');
  });
});

describe('previewFieldUpdate', () => {
  it('shows the new finish without saving anything', () => {
    Task.update.mockClear();
    const preview = previewFieldUpdate('clad', { percent_complete: 0, extraDays: 2 }, programme(), options());
    expect(preview).toEqual({ duration: 5, finishStr: '2026-11-12' }); // was Tue 10 Nov
    expect(Task.update).not.toHaveBeenCalled();
  });
});

describe('extendTask', () => {
  beforeEach(() => {
    Task.update.mockClear();
    bulkUpdateSchedule.mockClear();
  });

  it('saves % + extra days on the task and pushes linked tasks out by the same days', async () => {
    const { patches, scheduledMap } = await extendTask('clad', { percent_complete: 0, extraDays: 2 }, programme(), options());

    expect(Task.update).toHaveBeenCalledTimes(1);
    const [id, payload] = Task.update.mock.calls[0];
    expect(id).toBe('clad');
    expect(payload).toMatchObject({ duration: 5, percent_complete: 0, end_date: '2026-11-12' });

    expect(scheduledMap.get('paint').startStr).toBe('2026-11-13');
    expect(scheduledMap.get('paint').finishStr).toBe('2026-11-16'); // over the weekend
    const cascade = bulkUpdateSchedule.mock.calls[0][0];
    expect(cascade.map(p => p.id)).toEqual(['paint']);
    expect(patches.map(p => p.id).sort()).toEqual(['clad', 'paint']);
  });

  it('a half day on a task finishing at noon keeps the successor on the same day', async () => {
    const tasks = programme().map(t => (t.id === 'clad' ? { ...t, duration: 2.5 } : t));
    const before = runScheduleEngine(tasks, '2026-11-02', DEFAULT_CALENDAR).get('paint').startStr;
    const { scheduledMap } = await extendTask('clad', { percent_complete: 0, extraDays: 0.5 }, tasks, options());
    expect(scheduledMap.get('clad').durationDays).toBe(3);
    // Clad now ends at 17:00 instead of 12:00, so Paint starts the next morning
    expect(slip(before, scheduledMap.get('paint').startStr)).toBe(1);
  });
});
