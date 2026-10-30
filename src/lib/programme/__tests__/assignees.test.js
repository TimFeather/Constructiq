import { describe, it, expect } from 'vitest';
import {
  taskAssignees, assigneeNames, isAssignedTo, assigneeFilterOptions, hasAssigneeKey, formatLoggedAssignees,
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

  it('formats change-log values as names', () => {
    expect(formatLoggedAssignees(JSON.stringify([abc, builder]))).toBe('ABC Plumbing, Builder');
    expect(formatLoggedAssignees('[]')).toBe('none');
    expect(formatLoggedAssignees(null)).toBeNull();
    expect(formatLoggedAssignees('not json')).toBe('not json');
  });
});
