/**
 * programmeData.js
 *
 * Data access for the programme/scheduling module.
 *
 * Dependencies live in the normalized task_dependencies table (migration
 * 006). This module re-attaches them to each task as the `predecessors`
 * array shape the scheduling engine and Gantt renderer already consume:
 *   [{ predecessor_id, type, lag_hours, lag_days, is_elapsed, is_disabled }]
 * It also maps the DB column `constraint_data` onto `task.constraint`,
 * which is the key the engine reads.
 */

import { supabase } from '@/api/supabaseClient';
import { fetchAllRows } from '@/api/fetchAllRows';
import { Programme, Task, TaskChangeLog, TaskDependency } from '@/api/entities';
import { linkTradeAssignees, linkTradeResourceMap } from '@/lib/scheduleImportResources';

/** Attach engine-shaped predecessors + constraint to a task list. */
function attachEngineShape(tasks, depsBySuccessor) {
  return tasks.map(task => ({
    ...task,
    constraint: task.constraint_data || null,
    predecessors: depsBySuccessor.get(task.id) || [],
  }));
}

/**
 * The one query for a project's programme tasks. Every screen reading
 * ['tasks', projectId] must use this: react-query caches by key, so a second
 * fetcher under the same key hands its rows to whichever screen opens next.
 */
export function programmeTasksQuery(projectId) {
  return {
    queryKey: ['tasks', projectId],
    queryFn: () => fetchProgrammeTasks(projectId),
    staleTime: 30000,
  };
}

/**
 * Fetch tasks (+ dependencies) for one project or 'all'.
 * Returns tasks in sort_order with `predecessors` and `constraint` attached.
 * Throws if either read fails: tasks without their links schedule to the wrong
 * dates, so they must never pass for a successful load.
 */
export async function fetchProgrammeTasks(projectId) {
  const oneProject = projectId && projectId !== 'all';
  const [tasks, deps] = await Promise.all([
    fetchAllRows(() => {
      const query = supabase.from('tasks').select('*', { count: 'exact' })
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      return oneProject ? query.eq('project_id', projectId) : query;
    }),
    fetchAllRows(() => {
      const query = supabase.from('task_dependencies').select('*', { count: 'exact' })
        .order('id', { ascending: true });
      return oneProject ? query.eq('project_id', projectId) : query;
    }),
  ]);

  const depsBySuccessor = new Map();
  for (const d of deps) {
    if (!depsBySuccessor.has(d.successor_task_id)) depsBySuccessor.set(d.successor_task_id, []);
    depsBySuccessor.get(d.successor_task_id).push({
      predecessor_id: d.predecessor_task_id,
      type: d.type || 'FS',
      lag_days: Number(d.lag_days) || 0,
      lag_hours: (Number(d.lag_days) || 0) * 8,
      is_elapsed: !!d.is_elapsed,
      is_disabled: !!d.is_disabled,
      _depId: d.id,
    });
  }

  return attachEngineShape(tasks, depsBySuccessor);
}

/**
 * Replace a task's predecessor set with `preds`
 * ([{ predecessor_id, type, lag_days|lag_hours, is_elapsed }]).
 * Delete-then-insert; RLS restricts to admin/pricing/internal.
 */
export async function setTaskDependencies(taskId, projectId, preds) {
  const rows = (preds || [])
    .filter(p => (p.predecessor_id || p.task_id) && (p.predecessor_id || p.task_id) !== taskId)
    .map(p => ({
      project_id: projectId,
      predecessor_task_id: p.predecessor_id || p.task_id,
      successor_task_id: taskId,
      type: ['FS', 'SS', 'FF', 'SF'].includes(p.type) ? p.type : 'FS',
      lag_days: p.lag_days ?? ((p.lag_hours ?? 0) / 8),
      is_elapsed: !!p.is_elapsed,
      is_disabled: !!p.is_disabled,
    }));

  const { data, error } = await supabase.rpc('set_task_dependencies', {
    p_successor_task_id: taskId,
    p_project_id: projectId,
    p_deps: rows.map(({ predecessor_task_id, type, lag_days, is_elapsed, is_disabled }) => ({
      predecessor_task_id,
      type,
      lag_days,
      is_elapsed,
      is_disabled,
    })),
  });
  if (!error) return data;

  console.warn('set_task_dependencies RPC unavailable, falling back to delete+insert:', error.message);
  const { error: delError } = await supabase
    .from('task_dependencies')
    .delete()
    .eq('successor_task_id', taskId);
  if (delError) throw delError;

  if (rows.length) {
    const { error: insError } = await supabase.from('task_dependencies').insert(rows);
    if (insError) throw insError;
  }
  return rows.length;
}

/**
 * Persist cascade patches [{ id, start_date, end_date, duration }] in one
 * round trip via the bulk_update_task_schedule RPC (RLS applies).
 * Falls back to chunked parallel updates pre-migration.
 */
export async function bulkUpdateSchedule(patches) {
  if (!patches?.length) return 0;

  const payload = patches.map(p => ({
    id: p.id,
    start_date: p.start_date ?? null,
    end_date: p.end_date ?? null,
    duration: p.duration ?? null,
  }));

  const { data, error } = await supabase.rpc('bulk_update_task_schedule', { patches: payload });
  if (!error) return data;

  console.warn('bulk_update_task_schedule RPC unavailable, falling back to per-task updates:', error.message);
  const CHUNK = 20;
  for (let i = 0; i < payload.length; i += CHUNK) {
    await Promise.all(
      payload.slice(i, i + CHUNK).map(({ id, ...fields }) => Task.update(id, fields))
    );
  }
  return payload.length;
}

/**
 * Persist WBS renumber patches [{ id, wbs }] in one round trip via the
 * bulk_update_task_wbs RPC (RLS applies). Falls back to chunked updates
 * pre-migration (before the RPC has been created).
 */
export async function bulkUpdateTaskWbs(patches) {
  if (!patches?.length) return 0;

  const { data, error } = await supabase.rpc('bulk_update_task_wbs', { patches });
  if (!error) return data;

  console.warn('bulk_update_task_wbs RPC unavailable, falling back to per-task updates:', error.message);
  const CHUNK = 20;
  for (let i = 0; i < patches.length; i += CHUNK) {
    await Promise.all(
      patches.slice(i, i + CHUNK).map(({ id, wbs }) => Task.update(id, { wbs }))
    );
  }
  return patches.length;
}

/** Fetch the programmes row for a project (null if none yet). */
export async function fetchProgramme(projectId) {
  if (!projectId || projectId === 'all') return null;
  const { data, error } = await supabase
    .from('programmes')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Fetch programmes rows for many projects at once. Returns Map<project_id, programme>. */
/** The one query for every programme row, as a Map keyed by project_id. */
export function programmesByProjectQuery() {
  return {
    queryKey: ['programmes'],
    queryFn: fetchProgrammesByProject,
  };
}

export async function fetchProgrammesByProject() {
  const { data, error } = await supabase.from('programmes').select('*');
  if (error) throw error;
  return new Map(data.map(p => [p.project_id, p]));
}

// ─── Company calendar (migration 033) ─────────────────────────────────────────
// Shutdowns + custom holidays that apply to every programme, merged with each
// programme's own by calendarForProgramme. One row, id = true.

export const EMPTY_COMPANY_CALENDAR = Object.freeze({ holidays: [], shutdowns: [] });

// PostgREST / Postgres codes for "that table isn't there" — migration 033 not run yet
const TABLE_MISSING = new Set(['42P01', 'PGRST205']);

/**
 * The one query for the company calendar. Every screen that schedules must
 * pass its data to calendarForProgramme — a screen without it would put tasks
 * on different dates from the Gantt (and cascade-save them there).
 */
export function companyCalendarQuery() {
  return {
    queryKey: ['company_calendar'],
    queryFn: fetchCompanyCalendar,
    staleTime: 5 * 60 * 1000,
  };
}

export async function fetchCompanyCalendar() {
  const { data, error } = await supabase
    .from('company_calendar')
    .select('holidays, shutdowns')
    .maybeSingle();
  if (error) {
    // Before the migration runs, schedule exactly as before
    if (TABLE_MISSING.has(error.code)) return EMPTY_COMPANY_CALENDAR;
    throw error;
  }
  return {
    holidays: data?.holidays || [],
    shutdowns: data?.shutdowns || [],
  };
}

/** Replace the company-wide holidays/shutdowns. Admin only (RLS). */
export async function updateCompanyCalendar({ holidays, shutdowns }) {
  const { data, error } = await supabase
    .from('company_calendar')
    .update({ holidays, shutdowns, updated_at: new Date().toISOString() })
    .eq('id', true)
    .select('id');
  if (error) {
    if (TABLE_MISSING.has(error.code)) {
      throw new Error('Company-wide settings need database migration 033 (company_calendar) to be run first.');
    }
    throw error;
  }
  // RLS filters a non-admin's update to zero rows rather than erroring
  if (!data?.length) throw new Error('Only admins can change settings for all programmes.');
}

/**
 * Update (or create on first write) the programmes row for a project.
 */
export async function upsertProgramme(projectId, fields) {
  const existing = await fetchProgramme(projectId);
  if (existing) {
    return Programme.update(existing.id, { ...fields, updated_at: new Date().toISOString() });
  }
  return Programme.create({ project_id: projectId, ...fields });
}

/**
 * Just the assignees of a project's tasks — for screens outside the
 * programme that only need who is on what (not the ['tasks'] cache key,
 * which belongs to fetchProgrammeTasks).
 */
export function fetchTaskAssignees(projectId) {
  return fetchAllRows(() => supabase
    .from('tasks').select('id, assignees', { count: 'exact' })
    .eq('project_id', projectId)
    .order('id', { ascending: true }));
}

/**
 * Point a project's name-only programme resources ("Plumber", "ABC Plumbing")
 * at the team member they name — see linkTradeAssignees. Run after subs join
 * the team so a programme built on trades links up to them. Assignees aren't
 * schedule fields (the publish lock leaves them editable), so tasks are
 * updated directly, with the change logged like an editor save.
 *
 * @returns {Promise<number>} how many tasks were relinked
 */
export async function linkProgrammeToTeam(projectId, team, userId = null) {
  if (!projectId) return 0;
  const rows = await fetchTaskAssignees(projectId);

  const changes = linkTradeAssignees(rows, team);
  const CHUNK = 20;
  for (let i = 0; i < changes.length; i += CHUNK) {
    await Promise.all(changes.slice(i, i + CHUNK).map(c => Task.update(c.id, { assignees: c.assignees })));
  }
  if (changes.length) {
    TaskChangeLog.bulkCreate(changes.map(c => ({
      task_id: c.id,
      project_id: projectId,
      field_changed: 'assignees',
      old_value: JSON.stringify(c.before),
      new_value: JSON.stringify(c.assignees),
      changed_by: userId,
      trigger_task_id: null,
    }))).catch(err => console.warn('task_change_log write failed (link unaffected):', err.message));
  }

  // The saved import choices too, or the next MS Project update re-labels them.
  const programme = await fetchProgramme(projectId);
  const nextMap = programme ? linkTradeResourceMap(programme.resource_map, team) : null;
  if (nextMap) await Programme.update(programme.id, { resource_map: nextMap });

  return changes.length;
}

/**
 * Publish a project's programme — locks the schedule (dates, duration,
 * hierarchy, dependencies) for non-admins; progress tracking stays open.
 * Throws if the caller lacks admin/internal/pricing role.
 */
export async function publishProgramme(projectId) {
  const { data, error } = await supabase.rpc('publish_programme', { p_project_id: projectId });
  if (error) throw error;
  return data;
}

/** Unpublish (unlock) a project's programme. Admin only. */
export async function unpublishProgramme(projectId) {
  const { data, error } = await supabase.rpc('unpublish_programme', { p_project_id: projectId });
  if (error) throw error;
  return data;
}

export { TaskDependency };
