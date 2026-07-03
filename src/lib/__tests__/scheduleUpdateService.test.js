import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/entities', () => ({
  Task: { update: vi.fn(async () => ({})) },
  TaskChangeLog: { bulkCreate: vi.fn(async rows => rows) },
}));
vi.mock('@/api/programmeData', () => ({
  bulkUpdateSchedule: vi.fn(async patches => patches.length),
  setTaskDependencies: vi.fn(async () => 0),
}));

import { Task, TaskChangeLog } from '@/api/entities';
import { bulkUpdateSchedule, setTaskDependencies } from '@/api/programmeData';
import {
  applyScheduleUpdate,
  updateTaskDuration,
  updateTaskDependency,
  updateTaskProgress,
} from '../scheduleUpdateService.js';

const CAL = { type: '5day', holidays: [], shutdowns: [] };

function makeTasks() {
  // A: Mon 5 Jan - Fri 9 Jan (5d); B follows FS: Mon 12 - Tue 13 (2d)
  return [
    {
      id: 'A', project_id: 'p1', name: 'A', parent_id: null,
      start_date: '2026-01-05', end_date: '2026-01-09', duration: 5,
      predecessors: [], percent_complete: 0, actual_start: null, actual_finish: null, constraint: null,
    },
    {
      id: 'B', project_id: 'p1', name: 'B', parent_id: null,
      start_date: '2026-01-12', end_date: '2026-01-13', duration: 2,
      predecessors: [{ predecessor_id: 'A', type: 'FS', lag_hours: 0, is_elapsed: false }],
      percent_complete: 0, actual_start: null, actual_finish: null, constraint: null,
    },
  ];
}

const OPTS = { userId: 'user-1', projectStart: '2026-01-05', calendar: CAL, dataDate: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('applyScheduleUpdate', () => {
  it('persists the direct edit and cascades successors in one bulk call', async () => {
    const tasks = makeTasks();
    const { patches } = await updateTaskDuration('A', 7, tasks, OPTS);

    // A extended to 7d -> EF Tue 13 Jan; B pushed to Wed 14 - Thu 15
    const bPatch = patches.find(p => p.id === 'B');
    expect(bPatch.start_date).toBe('2026-01-14');
    expect(bPatch.end_date).toBe('2026-01-15');

    // Direct task saved via Task.update, cascade via ONE bulk call
    expect(Task.update).toHaveBeenCalledTimes(1);
    expect(Task.update.mock.calls[0][0]).toBe('A');
    expect(Task.update.mock.calls[0][1].duration).toBe(7);
    expect(bulkUpdateSchedule).toHaveBeenCalledTimes(1);
    expect(bulkUpdateSchedule.mock.calls[0][0].map(p => p.id)).toEqual(['B']);
  });

  it('writes the audit trail: direct rows carry changed_by, cascades carry trigger_task_id', async () => {
    const tasks = makeTasks();
    await updateTaskDuration('A', 7, tasks, OPTS);

    expect(TaskChangeLog.bulkCreate).toHaveBeenCalledTimes(1);
    const rows = TaskChangeLog.bulkCreate.mock.calls[0][0];

    const direct = rows.filter(r => r.task_id === 'A');
    expect(direct.some(r => r.field_changed === 'duration' && r.changed_by === 'user-1' && r.trigger_task_id === null)).toBe(true);

    const cascaded = rows.filter(r => r.task_id === 'B');
    expect(cascaded.length).toBeGreaterThan(0);
    for (const row of cascaded) {
      expect(row.changed_by).toBeNull();
      expect(row.trigger_task_id).toBe('A');
    }
  });

  it('maps constraint onto constraint_data and routes predecessors to setTaskDependencies', async () => {
    const tasks = makeTasks();
    const preds = [{ predecessor_id: 'A', type: 'SS', lag_hours: 8, is_elapsed: false }];
    await applyScheduleUpdate('B', {
      predecessors: preds,
      constraint: { type: 'SNET', date: '2026-01-06' },
    }, tasks, OPTS);

    expect(setTaskDependencies).toHaveBeenCalledWith('B', 'p1', preds);
    const payload = Task.update.mock.calls[0][1];
    expect(payload.constraint_data).toEqual({ type: 'SNET', date: '2026-01-06' });
    expect(payload.constraint).toBeUndefined();
    expect(payload.predecessors).toBeUndefined();
  });
});

describe('updateTaskDependency', () => {
  it('rejects circular dependencies with a clear error and writes nothing', async () => {
    const tasks = makeTasks();
    // A <- B exists; adding B as predecessor of A closes the loop
    await expect(
      updateTaskDependency('A', [{ predecessor_id: 'B', type: 'FS', lag_hours: 0 }], tasks, OPTS)
    ).rejects.toThrow(/Circular dependency/);
    expect(Task.update).not.toHaveBeenCalled();
    expect(setTaskDependencies).not.toHaveBeenCalled();
  });

  it('rejects self-links', async () => {
    const tasks = makeTasks();
    await expect(
      updateTaskDependency('A', [{ predecessor_id: 'A', type: 'FS', lag_hours: 0 }], tasks, OPTS)
    ).rejects.toThrow(/cannot depend on itself/);
  });
});

describe('updateTaskProgress', () => {
  it('takes the fast path (no cascade) for an on-time completion', async () => {
    const tasks = makeTasks();
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    tasks[0].end_date = todayStr; // planned finish is today -> completing now is on-time

    await updateTaskProgress('A', 100, tasks, OPTS);
    expect(bulkUpdateSchedule).not.toHaveBeenCalled();
    expect(Task.update).toHaveBeenCalledTimes(1);
    expect(Task.update.mock.calls[0][1].percent_complete).toBe(100);
    expect(Task.update.mock.calls[0][1].actual_finish).toBe(todayStr);
  });

  it('cascades when the task finishes late (real slip trigger)', async () => {
    const tasks = makeTasks();
    // Planned finish 2026-01-09; actual finish (today, real clock) differs -> slip
    await updateTaskProgress('A', 100, tasks, OPTS);

    // The engine repins A to its actual finish and pushes B
    expect(bulkUpdateSchedule).toHaveBeenCalled();
    const patched = bulkUpdateSchedule.mock.calls[0][0];
    expect(patched.some(p => p.id === 'B')).toBe(true);
  });

  it('backfills actual_start from the planned start on first progress', async () => {
    const tasks = makeTasks();
    await updateTaskProgress('A', 25, tasks, OPTS);
    const payload = Task.update.mock.calls[0][1];
    expect(payload.percent_complete).toBe(25);
    expect(payload.actual_start).toBe('2026-01-05'); // planned start, not today
  });
});
