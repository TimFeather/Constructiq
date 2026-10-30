-- ============================================================
-- Migration 030 — task assignees + MS Project resource map
-- Run in Supabase SQL Editor.
-- Safe to re-run.
--
-- tasks.assignees: who does the task, several per task. Filled from
-- MS Project resource assignments on import, editable in CIQ. Replaces
-- the single assignee_name/assignee_email pair, which nothing writes.
--   [{ "name": "ABC Plumbing", "email": "office@abc.co.nz",
--      "msp_resource_uid": 3, "units": 1 }]
--   email is null for a label-only assignee ("Builder", "Labourer").
--
-- programmes.resource_map: the import's resource → team member choices,
-- keyed by MS Project resource UID, so re-imports don't ask again.
--   { "3": { "name": "ABC Plumbing Ltd", "action": "member",
--            "email": "office@abc.co.nz" },
--     "5": { "name": "Builder", "action": "label" },
--     "7": { "name": "Labour", "action": "ignore" } }
--
-- Grants: both are new columns on existing tables, so the table-level
-- grants already cover them, with one exception. Migration 012 replaced
-- authenticated's UPDATE on programmes with a column list, so every
-- programmes column added since needs its own grant. That includes
-- critical_slack_tolerance_days from 017, which never got one: without it
-- the Schedule Settings save fails with 42501 unless it was granted by
-- hand. Re-granting is harmless.
--
-- The publish lock (012) only blocks schedule columns, so assignees stay
-- editable on a published programme, same as progress fields.
-- ============================================================

alter table public.tasks
  add column if not exists assignees jsonb not null default '[]';

alter table public.tasks drop constraint if exists tasks_assignees_is_array;
alter table public.tasks
  add constraint tasks_assignees_is_array check (jsonb_typeof(assignees) = 'array');

alter table public.programmes
  add column if not exists resource_map jsonb not null default '{}';

alter table public.programmes drop constraint if exists programmes_resource_map_is_object;
alter table public.programmes
  add constraint programmes_resource_map_is_object check (jsonb_typeof(resource_map) = 'object');

grant update (resource_map, critical_slack_tolerance_days) on public.programmes to authenticated;

-- ============================================================
-- Verification (run after applying):
--
--   select table_name, column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and ((table_name = 'tasks'      and column_name = 'assignees')
--       or (table_name = 'programmes' and column_name = 'resource_map'));
--   -- expect 2 rows: jsonb, is_nullable = NO, defaults '[]' / '{}'
--
--   select
--     has_column_privilege('authenticated', 'public.tasks', 'assignees', 'UPDATE')                         as task_assignees,
--     has_column_privilege('authenticated', 'public.programmes', 'resource_map', 'UPDATE')                 as resource_map,
--     has_column_privilege('authenticated', 'public.programmes', 'critical_slack_tolerance_days', 'UPDATE') as slack_tolerance,
--     has_column_privilege('service_role',  'public.tasks', 'assignees', 'SELECT')                         as fn_reads_assignees;
--   -- expect all four true
-- ============================================================
