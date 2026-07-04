-- ════════════════════════════════════════════════════════════════════
-- Migration 006 — Programme scheduling engine data model
--
-- Adds: programmes (per-project calendar + data date), normalized
-- task_dependencies, baselines, progress log, change log (audit trail),
-- tasks.mspdi_uid for MS Project round-trips, a bulk schedule-update
-- RPC, and aligns the tasks write policies with the app's role rules
-- (pricing can write; external is strictly read-only).
--
-- Safe to run once on the live database via the Supabase SQL Editor.
-- The legacy tasks.predecessors JSONB column is kept (read-only
-- fallback / rollback safety) — the app stops writing it after this.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. programmes (one per project: data date + working calendar) ────
create table if not exists public.programmes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null unique references public.projects(id) on delete cascade,
  name          text,
  data_date     date,                          -- status date; null = "today"
  calendar      jsonb not null default '{"type":"5day","holidays":[],"shutdowns":[],"hours_per_day":8,"region":"hawkes-bay"}',
  created_by_id uuid references public.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table public.programmes enable row level security;

drop policy if exists "programmes_select" on public.programmes;
create policy "programmes_select" on public.programmes for select using (
  get_my_role() in ('admin','internal','pricing')
  or exists (
       select 1 from public.projects p
       where p.id = programmes.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);
drop policy if exists "programmes_insert" on public.programmes;
create policy "programmes_insert" on public.programmes for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "programmes_update" on public.programmes;
create policy "programmes_update" on public.programmes for update using (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "programmes_delete" on public.programmes;
create policy "programmes_delete" on public.programmes for delete using (
  get_my_role() = 'admin'
);

-- ── 2. task_dependencies (normalized; replaces tasks.predecessors JSONB) ──
create table if not exists public.task_dependencies (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  predecessor_task_id uuid not null references public.tasks(id) on delete cascade,
  successor_task_id   uuid not null references public.tasks(id) on delete cascade,
  type                text not null default 'FS' check (type in ('FS','SS','FF','SF')),
  lag_days            numeric not null default 0,   -- signed; negative = lead; fractional ok (0.5 = 4h)
  is_elapsed          boolean not null default false,
  created_at          timestamptz default now(),
  unique (predecessor_task_id, successor_task_id),
  check (predecessor_task_id <> successor_task_id)
);
create index if not exists task_dependencies_project_idx     on public.task_dependencies (project_id);
create index if not exists task_dependencies_predecessor_idx on public.task_dependencies (predecessor_task_id);
create index if not exists task_dependencies_successor_idx   on public.task_dependencies (successor_task_id);
alter table public.task_dependencies enable row level security;

drop policy if exists "task_dependencies_select" on public.task_dependencies;
create policy "task_dependencies_select" on public.task_dependencies for select using (
  get_my_role() in ('admin','internal','pricing')
  or exists (
       select 1 from public.projects p
       where p.id = task_dependencies.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);
drop policy if exists "task_dependencies_insert" on public.task_dependencies;
create policy "task_dependencies_insert" on public.task_dependencies for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "task_dependencies_update" on public.task_dependencies;
create policy "task_dependencies_update" on public.task_dependencies for update using (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "task_dependencies_delete" on public.task_dependencies;
create policy "task_dependencies_delete" on public.task_dependencies for delete using (
  get_my_role() in ('admin','internal','pricing')
);

-- ── 3. tasks.mspdi_uid — preserves the MS Project UID for round-trip
--       import/export (update-vs-append matching) ─────────────────────
alter table public.tasks add column if not exists mspdi_uid integer;
create index if not exists tasks_project_mspdi_uid_idx on public.tasks (project_id, mspdi_uid);

-- ── 4. baselines ─────────────────────────────────────────────────────
create table if not exists public.task_baselines (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  name          text not null,
  created_by_id uuid references public.users(id),
  created_at    timestamptz default now()
);
create table if not exists public.task_baseline_items (
  id                uuid primary key default gen_random_uuid(),
  baseline_id       uuid not null references public.task_baselines(id) on delete cascade,
  task_id           uuid not null references public.tasks(id) on delete cascade,
  baseline_start    date,
  baseline_finish   date,
  baseline_duration numeric,
  unique (baseline_id, task_id)
);
create index if not exists task_baselines_project_idx      on public.task_baselines (project_id);
create index if not exists task_baseline_items_baseline_idx on public.task_baseline_items (baseline_id);
alter table public.task_baselines enable row level security;
alter table public.task_baseline_items enable row level security;

drop policy if exists "task_baselines_select" on public.task_baselines;
create policy "task_baselines_select" on public.task_baselines for select using (
  get_my_role() in ('admin','internal','pricing')
  or exists (
       select 1 from public.projects p
       where p.id = task_baselines.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);
drop policy if exists "task_baselines_insert" on public.task_baselines;
create policy "task_baselines_insert" on public.task_baselines for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "task_baselines_delete" on public.task_baselines;
create policy "task_baselines_delete" on public.task_baselines for delete using (
  get_my_role() in ('admin','pricing')
);

drop policy if exists "task_baseline_items_select" on public.task_baseline_items;
create policy "task_baseline_items_select" on public.task_baseline_items for select using (
  exists (select 1 from public.task_baselines b where b.id = task_baseline_items.baseline_id)
);
drop policy if exists "task_baseline_items_insert" on public.task_baseline_items;
create policy "task_baseline_items_insert" on public.task_baseline_items for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "task_baseline_items_delete" on public.task_baseline_items;
create policy "task_baseline_items_delete" on public.task_baseline_items for delete using (
  get_my_role() in ('admin','pricing')
);

-- ── 5. task_progress_log — immutable field progress entries ──────────
create table if not exists public.task_progress_log (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.tasks(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  updated_by       uuid references public.users(id),
  previous_percent numeric,
  new_percent      numeric,
  note             text,
  delay_reason     text check (delay_reason in
    ('weather','materials','labour','design_change','client_variation','site_access','other')),
  photo_path       text,             -- storage path in 'project-files' (signed at view time)
  created_at       timestamptz default now()
);
create index if not exists task_progress_log_task_idx on public.task_progress_log (task_id, created_at desc);
alter table public.task_progress_log enable row level security;

drop policy if exists "task_progress_log_select" on public.task_progress_log;
create policy "task_progress_log_select" on public.task_progress_log for select using (
  get_my_role() in ('admin','internal','pricing')
  or exists (
       select 1 from public.projects p
       where p.id = task_progress_log.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);
drop policy if exists "task_progress_log_insert" on public.task_progress_log;
create policy "task_progress_log_insert" on public.task_progress_log for insert with check (
  get_my_role() in ('admin','internal','pricing')
  and updated_by = auth.uid()
);
-- No update/delete policies: the progress log is immutable.

-- ── 6. task_change_log — the schedule audit trail ────────────────────
-- Every date/duration/dependency change writes a row here — manual edits
-- carry changed_by; engine cascades carry changed_by = null and
-- trigger_task_id = the task whose edit kicked off the recalc.
create table if not exists public.task_change_log (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  field_changed   text not null,
  old_value       text,
  new_value       text,
  changed_by      uuid references public.users(id),
  trigger_task_id uuid references public.tasks(id) on delete set null,
  created_at      timestamptz default now()
);
create index if not exists task_change_log_task_idx on public.task_change_log (task_id, created_at desc);
alter table public.task_change_log enable row level security;

drop policy if exists "task_change_log_select" on public.task_change_log;
create policy "task_change_log_select" on public.task_change_log for select using (
  get_my_role() in ('admin','internal','pricing')
  or exists (
       select 1 from public.projects p
       where p.id = task_change_log.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);
drop policy if exists "task_change_log_insert" on public.task_change_log;
create policy "task_change_log_insert" on public.task_change_log for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
-- No update/delete policies: the change log is immutable.

-- ── 7. Backfill: tasks.predecessors JSONB → task_dependencies rows ───
-- Legacy rows use either 'predecessor_id' or 'task_id' for the
-- predecessor; lag may be lag_days or lag_hours (8h working day).
-- Dangling references (deleted tasks) are skipped.
insert into public.task_dependencies
  (project_id, predecessor_task_id, successor_task_id, type, lag_days, is_elapsed)
select
  t.project_id,
  coalesce(p->>'predecessor_id', p->>'task_id')::uuid,
  t.id,
  case when coalesce(nullif(p->>'type',''),'FS') in ('FS','SS','FF','SF')
       then coalesce(nullif(p->>'type',''),'FS') else 'FS' end,
  coalesce(
    (p->>'lag_days')::numeric,
    (p->>'lag_hours')::numeric / 8.0,
    0
  ),
  coalesce((p->>'is_elapsed')::boolean, false)
from public.tasks t
cross join lateral jsonb_array_elements(coalesce(t.predecessors, '[]'::jsonb)) p
where coalesce(p->>'predecessor_id', p->>'task_id') is not null
  and coalesce(p->>'predecessor_id', p->>'task_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (select 1 from public.tasks x
              where x.id = coalesce(p->>'predecessor_id', p->>'task_id')::uuid)
  and coalesce(p->>'predecessor_id', p->>'task_id')::uuid <> t.id
on conflict (predecessor_task_id, successor_task_id) do nothing;

-- ── 8. Bulk schedule persistence RPC ─────────────────────────────────
-- security invoker: RLS still applies to every row touched. One round
-- trip for a whole cascade instead of one request per task.
create or replace function public.bulk_update_task_schedule(patches jsonb)
returns integer
language sql
security invoker
as $$
  with p as (
    select * from jsonb_to_recordset(patches)
      as x(id uuid, start_date date, end_date date, duration numeric)
  ), upd as (
    update public.tasks t
       set start_date = p.start_date,
           end_date   = p.end_date,
           duration   = p.duration,
           updated_at = now()
      from p
     where t.id = p.id
     returning t.id
  )
  select count(*)::integer from upd;
$$;
grant execute on function public.bulk_update_task_schedule(jsonb) to authenticated;

-- ── 9. Align tasks write policies with app rules ─────────────────────
-- pricing gets write (MODULE_RULES already grants it edit in the UI);
-- external becomes strictly read-only — the old creator/assignee arms
-- let an external assignee update tasks.
drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update using (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks for delete using (
  get_my_role() in ('admin','internal','pricing')
);
