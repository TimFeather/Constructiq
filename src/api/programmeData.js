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
 *
 * The legacy tasks.predecessors JSONB column is read-only fallback for
 * databases where migration 006 hasn't run yet — never written.
 */

import { supabase } from '@/api/supabaseClient';
import { Programme, Task, TaskDependency } from '@/api/entities';

/** Attach engine-shaped predecessors + constraint to a task list. */
function attachEngineShape(tasks, depsBySuccessor) {
  return tasks.map(task => ({
    ...task,
    constraint: task.constraint_data || null,
    predecessors: depsBySuccessor
      ? (depsBySuccessor.get(task.id) || [])
      : (task.predecessors || []).map(p => ({
          ...p,
          predecessor_id: p.predecessor_id || p.task_id,
          is_disabled: p.is_disabled || false,
        })),
  }));
}

/**
 * Fetch tasks (+ dependencies) for one project or 'all'.
 * Returns tasks in sort_order with `predecessors` and `constraint` attached.
 */
export async function fetchProgrammeTasks(projectId) {
  let taskQuery = supabase.from('tasks').select('*').order('sort_order', { ascending: true }).limit(2000);
  let depQuery = supabase.from('task_dependencies').select('*');
  if (projectId && projectId !== 'all') {
    taskQuery = taskQuery.eq('project_id', projectId);
    depQuery = depQuery.eq('project_id', projectId);
  }

  const { data: tasks, error: taskError } = await taskQuery;
  if (taskError) throw taskError;

  const { data: deps, error: depError } = await depQuery;
  if (depError) {
    // Pre-migration database: fall back to the legacy JSONB column.
    console.warn('task_dependencies unavailable, using legacy JSONB predecessors:', depError.message);
    return attachEngineShape(tasks, null);
  }

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
  if (error) {
    console.warn('programmes unavailable:', error.message);
    return null;
  }
  return data;
}

/** Fetch programmes rows for many projects at once. Returns Map<project_id, programme>. */
export async function fetchProgrammesByProject() {
  const { data, error } = await supabase.from('programmes').select('*');
  if (error) return new Map();
  return new Map(data.map(p => [p.project_id, p]));
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
