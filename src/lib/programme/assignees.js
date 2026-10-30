/**
 * Reading tasks.assignees (migration 030) across the programme UI.
 * Each assignee is { name, person?, email, msp_resource_uid, units }: name
 * is the company (or person) shown on the task, person the team member's own
 * name, and email is null for a name-only assignee ("Builder", "Labourer").
 */

import { normalizeEmail } from '@/lib/normalizeEmail';
import { assigneeKey, normalizeName } from '@/lib/scheduleImportResources';
import { toDateStr } from '@/lib/scheduling/calendarEngine';

/** Window for the publish email's "your tasks" list. Its heading says "next 3 weeks". */
export const UPCOMING_TASK_DAYS = 21;

export const taskAssignees = (task) => (Array.isArray(task?.assignees) ? task.assignees : []);

/** "Sparks Electrical (Jo Watt)": the person shows, so two from one company differ. */
export function assigneeLabel(a) {
  if (!a?.name) return a?.person || a?.email || '';
  return a.person && normalizeName(a.person) !== normalizeName(a.name) ? `${a.name} (${a.person})` : a.name;
}

/** "ABC Plumbing (Sam Pipe), Builder", or '' when unassigned. */
export const assigneeNames = (task) => taskAssignees(task).map(assigneeLabel).filter(Boolean).join(', ');

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
      if (!byKey.has(key)) byKey.set(key, assigneeLabel(a) || 'Unnamed');
    }
  }
  return [...byKey.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Does the task have the assignee an assigneeFilterOptions value refers to? */
export const hasAssigneeKey = (task, key) => taskAssignees(task).some(a => assigneeKey(a) === key);

/**
 * Unfinished tasks and milestones with an emailed assignee that run within
 * the next `days` days, for the publish email's per-recipient task list.
 * Dates are the engine's (scheduledMap), the same ones the Gantt and the
 * attached PDF show; stored dates can lag them.
 *
 * @param {Object} [opts] - { today: 'yyyy-MM-dd' (default: local today), days }
 * @returns {Array<{ wbs, name, start, finish, emails: string[] }>} by start date
 */
export function upcomingAssignedTasks(tasks, scheduledMap, { today = toDateStr(new Date()), days = UPCOMING_TASK_DAYS } = {}) {
  const windowEnd = new Date(`${today}T00:00:00`);
  windowEnd.setDate(windowEnd.getDate() + days);
  const end = toDateStr(windowEnd);
  const parentIds = new Set((tasks || []).map(t => t.parent_id).filter(Boolean));

  const out = [];
  for (const t of tasks || []) {
    if (parentIds.has(t.id) || (t.percent_complete || 0) >= 100) continue;
    const emails = [...new Set(taskAssignees(t).map(a => normalizeEmail(a.email)).filter(Boolean))];
    if (!emails.length) continue;
    const resolved = scheduledMap?.get(t.id);
    const start = resolved?.startStr || t.start_date;
    const finish = resolved?.finishStr || t.end_date;
    if (!start || !finish || start > end || finish < today) continue;
    out.push({ wbs: t.wbs || '', name: t.name || '', start, finish, emails });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.wbs.localeCompare(b.wbs, undefined, { numeric: true }));
}

/** A change-log value for the assignees field (JSON text) as names. */
export function formatLoggedAssignees(raw) {
  if (raw == null || raw === '') return null;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return raw;
    return list.length ? list.map(assigneeLabel).filter(Boolean).join(', ') : 'none';
  } catch {
    return raw;
  }
}
