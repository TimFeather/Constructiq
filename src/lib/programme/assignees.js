/**
 * Reading tasks.assignees (migration 030) across the programme UI.
 * Each assignee is { name, email, msp_resource_uid, units }; email is null
 * for a name-only assignee ("Builder", "Labourer").
 */

import { normalizeEmail } from '@/lib/normalizeEmail';
import { assigneeKey } from '@/lib/scheduleImportResources';

export const taskAssignees = (task) => (Array.isArray(task?.assignees) ? task.assignees : []);

/** "ABC Plumbing, Builder", or '' when unassigned. */
export const assigneeNames = (task) => taskAssignees(task).map(a => a.name).filter(Boolean).join(', ');

/** Is this email (the signed-in user, say) one of the task's assignees? */
export function isAssignedTo(task, email) {
  const target = normalizeEmail(email);
  return !!target && taskAssignees(task).some(a => normalizeEmail(a.email) === target);
}

/**
 * Everyone assigned across a task list, for a filter dropdown: one option
 * per person or name-only assignee, sorted by name.
 *
 * @returns {Array<{ value: string, label: string }>} value is an assigneeKey
 */
export function assigneeFilterOptions(tasks) {
  const byKey = new Map();
  for (const t of tasks || []) {
    for (const a of taskAssignees(t)) {
      const key = assigneeKey(a);
      if (!byKey.has(key)) byKey.set(key, a.name || a.email || 'Unnamed');
    }
  }
  return [...byKey.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Does the task have the assignee an assigneeFilterOptions value refers to? */
export const hasAssigneeKey = (task, key) => taskAssignees(task).some(a => assigneeKey(a) === key);

/** A change-log value for the assignees field (JSON text) as names. */
export function formatLoggedAssignees(raw) {
  if (raw == null || raw === '') return null;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return raw;
    return list.length ? list.map(a => a?.name).filter(Boolean).join(', ') : 'none';
  } catch {
    return raw;
  }
}
