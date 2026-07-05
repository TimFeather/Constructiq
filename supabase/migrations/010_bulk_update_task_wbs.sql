-- 010_bulk_update_task_wbs.sql
-- RPC used by AddTaskDialog to persist WBS renumbering in one round trip
-- after inserting a task mid-group. Mirrors bulk_update_task_schedule
-- (migration 006): security invoker, so RLS still applies to the caller.

create or replace function bulk_update_task_wbs(patches jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  n integer := 0;
begin
  update tasks t
  set wbs = p.wbs
  from jsonb_to_recordset(patches) as p(id uuid, wbs text)
  where t.id = p.id;

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function bulk_update_task_wbs(jsonb) to authenticated;
