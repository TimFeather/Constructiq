-- 016_set_task_dependencies_rpc.sql
-- RPC used by setTaskDependencies (src/api/programmeData.js) to persist a
-- task's predecessor set atomically. Mirrors bulk_update_task_wbs (migration
-- 010) / bulk_update_task_schedule (migration 006): security invoker, so
-- RLS still applies to the caller. Replaces the previous delete-then-insert
-- (two round trips, no transaction — an insert failure left the task with
-- zero predecessors) with a single statement/transaction.

create or replace function public.set_task_dependencies(
  p_successor_task_id uuid,
  p_project_id uuid,
  p_deps jsonb
)
returns integer
language plpgsql
security invoker
as $$
declare
  n integer := 0;
begin
  delete from public.task_dependencies
  where successor_task_id = p_successor_task_id;

  insert into public.task_dependencies
    (project_id, predecessor_task_id, successor_task_id, type, lag_days, is_elapsed, is_disabled)
  select
    p_project_id,
    d.predecessor_task_id,
    p_successor_task_id,
    d.type,
    d.lag_days,
    d.is_elapsed,
    d.is_disabled
  from jsonb_to_recordset(p_deps) as d(
    predecessor_task_id uuid,
    type text,
    lag_days numeric,
    is_elapsed boolean,
    is_disabled boolean
  );

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.set_task_dependencies(uuid, uuid, jsonb) to authenticated;
