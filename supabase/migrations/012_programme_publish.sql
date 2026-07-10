-- ════════════════════════════════════════════════════════════════════
-- Migration 012 — Programme publish / edit-lock (not draft versioning)
--
-- Adds a status ('draft' | 'published') to each project's programmes
-- row. Publishing freezes the SCHEDULE (dates, duration, milestones,
-- hierarchy/WBS, dependencies, add/delete of tasks) for non-admins;
-- progress-tracking fields (percent_complete, actual_start/finish,
-- status_notes, delay_notes, task_status, assignee) stay editable so
-- the team can keep recording progress against a published baseline.
-- Admins can always edit, and are the only role that can unpublish.
--
-- Enforcement is via a BEFORE trigger on tasks/task_dependencies
-- (not a plain RLS USING clause) because a trigger can compare OLD vs
-- NEW per column — RLS alone can't distinguish "changed a date" from
-- "changed percent_complete" on the same row. This also means the
-- lock is honoured automatically by bulk_update_task_schedule and
-- bulk_update_task_wbs (both security invoker, so they still hit
-- these triggers) with no separate gate needed.
--
-- publish_programme()/unpublish_programme() are the only way to flip
-- status — direct client UPDATEs to programmes.status/published_at/
-- published_by_id are blocked by column-level grants below, so the
-- audit fields (published_at, published_by_id) can't drift from who
-- actually published.
--
-- Safe to run once on the live database via the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. programmes: publish state ──────────────────────────────────
alter table public.programmes add column if not exists status text not null default 'draft'
  check (status in ('draft','published'));
alter table public.programmes add column if not exists published_at timestamptz;
alter table public.programmes add column if not exists published_by_id uuid references public.users(id);

-- Only publish_programme()/unpublish_programme() (security definer, run
-- as table owner) may change status/published_at/published_by_id — the
-- app can still write the other fields (schedule settings) directly.
revoke update on public.programmes from authenticated;
grant update (name, data_date, calendar, updated_at) on public.programmes to authenticated;

-- ── 2. publish_programme / unpublish_programme ────────────────────
create or replace function public.publish_programme(p_project_id uuid)
returns public.programmes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
  v_row  public.programmes;
begin
  if v_role not in ('admin','internal','pricing') then
    raise exception 'Only admin, internal or pricing users may publish a programme';
  end if;

  update public.programmes
     set status          = 'published',
         published_at    = now(),
         published_by_id = auth.uid(),
         updated_at      = now()
   where project_id = p_project_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No programme exists for this project yet';
  end if;
  return v_row;
end;
$$;
grant execute on function public.publish_programme(uuid) to authenticated, service_role;

create or replace function public.unpublish_programme(p_project_id uuid)
returns public.programmes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
  v_row  public.programmes;
begin
  if v_role <> 'admin' then
    raise exception 'Only an admin may unpublish a programme';
  end if;

  update public.programmes
     set status          = 'draft',
         published_at    = null,
         published_by_id = null,
         updated_at      = now()
   where project_id = p_project_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No programme exists for this project yet';
  end if;
  return v_row;
end;
$$;
grant execute on function public.unpublish_programme(uuid) to authenticated, service_role;

-- ── 3. Enforce the lock on tasks ───────────────────────────────────
-- Admins bypass the lock entirely. Everyone else: blocked from
-- inserting/deleting tasks, or changing schedule-affecting columns,
-- while the project's programme is published. Progress-tracking
-- columns are deliberately excluded from the changed-column check.
create or replace function public.enforce_programme_lock() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked boolean;
begin
  if get_my_role() = 'admin' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    select exists(select 1 from public.programmes where project_id = old.project_id and status = 'published')
      into v_locked;
    if v_locked then
      raise exception 'Programme is published and locked — unpublish it to delete tasks';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    select exists(select 1 from public.programmes where project_id = new.project_id and status = 'published')
      into v_locked;
    if v_locked then
      raise exception 'Programme is published and locked — unpublish it to add tasks';
    end if;
    return new;
  end if;

  -- UPDATE: only block if a schedule-affecting field actually changed.
  if new.start_date   is distinct from old.start_date   or
     new.end_date     is distinct from old.end_date     or
     new.duration     is distinct from old.duration     or
     new.is_milestone is distinct from old.is_milestone or
     new.parent_id    is distinct from old.parent_id    or
     new.sort_order   is distinct from old.sort_order   or
     new.wbs          is distinct from old.wbs          or
     new.level        is distinct from old.level        or
     new.name         is distinct from old.name
  then
    select exists(select 1 from public.programmes where project_id = new.project_id and status = 'published')
      into v_locked;
    if v_locked then
      raise exception 'Programme is published and locked — unpublish it to edit the schedule';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_programme_lock on public.tasks;
create trigger tasks_programme_lock
  before insert or update or delete on public.tasks
  for each row execute function public.enforce_programme_lock();

-- ── 4. Enforce the lock on task_dependencies ───────────────────────
-- Dependencies are pure schedule structure — locked outright, no
-- column-level carve-out needed.
create or replace function public.enforce_programme_lock_deps() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked    boolean;
  v_project_id uuid := coalesce(new.project_id, old.project_id);
begin
  if get_my_role() = 'admin' then
    return coalesce(new, old);
  end if;

  select exists(select 1 from public.programmes where project_id = v_project_id and status = 'published')
    into v_locked;
  if v_locked then
    raise exception 'Programme is published and locked — unpublish it to edit dependencies';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists task_dependencies_programme_lock on public.task_dependencies;
create trigger task_dependencies_programme_lock
  before insert or update or delete on public.task_dependencies
  for each row execute function public.enforce_programme_lock_deps();

-- ── 5. project_activity: allow logging the publish/unpublish event ─
alter table public.project_activity drop constraint if exists project_activity_entity_type_check;
alter table public.project_activity add constraint project_activity_entity_type_check
  check (entity_type in ('project','document','rfi','programme'));

-- ============================================================
-- Verification (run after applying):
--
-- select column_name from information_schema.columns
--   where table_name = 'programmes' and column_name in ('status','published_at','published_by_id');
--
-- select * from pg_trigger where tgname in ('tasks_programme_lock','task_dependencies_programme_lock');
--
-- -- as a non-admin, after publishing a programme, this should raise:
-- -- select public.publish_programme('<project_id>');
-- -- update public.tasks set start_date = start_date + 1 where project_id = '<project_id>' limit 1;
-- ============================================================
