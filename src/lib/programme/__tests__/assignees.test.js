import { describe, it, expect } from 'vitest';
import {
  taskAssignees, assigneeNames, isAssignedTo, assigneeFilterOptions, hasAssigneeKey, formatLoggedAssignees,
  upcomingAssignedTasks,
} from '../assignees.js';

const abc = { name: 'ABC Plumbing', email: 'Office@ABC.co.nz', msp_resource_uid: 1, units: 1 };
const builder = { name: 'Builder', email: null, msp_resource_uid: 5, units: 1 };
const tasks = [
  { id: 'a', assignees: [abc, builder] },
  { id: 'b', assignees: [{ ...builder, name: 'builder' }] },
  { id: 'c', assignees: [] },
  { id: 'd' }, // row from before migration 030
];

describe('assignees helpers', () => {
  it('reads assignees defensively', () => {
    expect(taskAssignees(tasks[3])).toEqual([]);
    expect(assigneeNames(tasks[0])).toBe('ABC Plumbing, Builder');
    expect(assigneeNames(tasks[2])).toBe('');
  });

  it('matches the signed-in user by email, case-insensitively', () => {
    expect(isAssignedTo(tasks[0], 'office@abc.co.nz')).toBe(true);
    expect(isAssignedTo(tasks[1], 'office@abc.co.nz')).toBe(false);
    expect(isAssignedTo(tasks[0], '')).toBe(false);
  });

  it('builds one filter option per person or name, sorted', () => {
    const options = assigneeFilterOptions(tasks);
    expect(options.map(o => o.label)).toEqual(['ABC Plumbing', 'Builder']);
    const builderKey = options.find(o => o.label === 'Builder').value;
    expect(tasks.filter(t => hasAssigneeKey(t, builderKey)).map(t => t.id)).toEqual(['a', 'b']);
  });

  describe('upcomingAssignedTasks', () => {
    const task = (id, extra) => ({ id, wbs: id, name: `Task ${id}`, percent_complete: 0, assignees: [abc], ...extra });
    const list = [
      task('1', { start_date: '2026-03-02', end_date: '2026-03-04' }),                    // in window
      task('2', { start_date: '2026-03-20', end_date: '2026-03-25' }),                    // starts on the window's last day
      task('3', { start_date: '2026-03-21', end_date: '2026-03-25' }),                    // after the window
      task('4', { start_date: '2026-02-20', end_date: '2026-02-26' }),                    // finished before today
      task('5', { start_date: '2026-02-25', end_date: '2026-03-03' }),                    // under way
      task('6', { start_date: '2026-03-02', end_date: '2026-03-02', percent_complete: 100 }), // done
      task('7', { start_date: '2026-03-02', end_date: '2026-03-03', assignees: [builder] }),  // name only, no email
      task('8', { start_date: '2026-03-02', end_date: '2026-03-10' }),                    // summary of 9
      task('9', { start_date: '2026-03-02', end_date: '2026-03-10', parent_id: '8' }),
    ];
    // Engine moved task 3 into the window; its stored dates lag
    const scheduled = new Map([['3', { startStr: '2026-03-16', finishStr: '2026-03-18' }]]);
    const upcoming = upcomingAssignedTasks(list, scheduled, { today: '2026-02-27', days: 21 });

    it('keeps unfinished leaf tasks with an emailed assignee that overlap the window, on engine dates', () => {
      expect(upcoming.map(t => t.wbs)).toEqual(['5', '1', '9', '3', '2']);
      expect(upcoming.find(t => t.wbs === '3')).toMatchObject({ start: '2026-03-16', finish: '2026-03-18' });
    });

    it('carries normalized emails for the function to match recipients on', () => {
      expect(upcoming[0]).toEqual({ wbs: '5', name: 'Task 5', start: '2026-02-25', finish: '2026-03-03', emails: ['office@abc.co.nz'] });
    });

    it('a window ending on a task start includes it', () => {
      expect(upcomingAssignedTasks(list, new Map(), { today: '2026-02-27', days: 21 }).map(t => t.wbs)).toContain('2');
    });
  });

  it('formats change-log values as names', () => {
    expect(formatLoggedAssignees(JSON.stringify([abc, builder]))).toBe('ABC Plumbing, Builder');
    expect(formatLoggedAssignees('[]')).toBe('none');
    expect(formatLoggedAssignees(null)).toBeNull();
    expect(formatLoggedAssignees('not json')).toBe('not json');
  });
});
