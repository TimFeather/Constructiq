-- ============================================================
-- Migration 008 — project activity log, RFI privacy, task policies
-- Run manually in the Supabase SQL editor.
--
-- 1) New table project_activity: shared activity feed for
--    projects / documents / RFIs (mirrors tender_activity, plus
--    entity_type/entity_id/metadata). Internal-only visibility.
-- 2) RFI privacy: external users no longer see every RFI on their
--    team projects — only RFIs they created, are assigned to, or
--    that are explicitly marked is_public = true.
--    NOTE: all existing rfis have is_public = false, so externals
--    immediately lose sight of RFIs they aren't assigned to /
--    didn't create. That IS the intended fix. An optional backfill
--    to keep historical RFIs visible is commented out at the end.
-- 3) Task policies: pricing added to tasks insert/update/delete.
--    The UI (permissions.js) already allows pricing to edit the
--    programme, but the live policies only allowed admin/internal,
--    so pricing users' task writes silently affected 0 rows.
-- ============================================================

-- ── 1. project_activity ─────────────────────────────────────
create table if not exists public.project_activity (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  -- entity_id intentionally has no FK: activity must outlive the
  -- document/RFI it describes (null for project-level events).
  entity_type text not null check (entity_type in ('project','document','rfi')),
  entity_id   uuid,
  event_type  text not null,
  actor_name  text,
  actor_email text,
  description text,
  metadata    jsonb default '{}'::jsonb,
  occurred_at timestamptz default now(),
  created_at  timestamptz default now()
);

create index if not exists idx_project_activity_project
  on public.project_activity (project_id, occurred_at desc);
create index if not exists idx_project_activity_entity
  on public.project_activity (entity_type, entity_id);

alter table public.project_activity enable row level security;

-- Internal-only, mirroring tender_activity ("ta_all" pattern).
drop policy if exists "project_activity_select" on public.project_activity;
create policy "project_activity_select" on public.project_activity for select using (
  get_my_role() in ('admin','pricing','internal')
);
drop policy if exists "project_activity_insert" on public.project_activity;
create policy "project_activity_insert" on public.project_activity for insert with check (
  get_my_role() in ('admin','pricing','internal')
);
drop policy if exists "project_activity_delete" on public.project_activity;
create policy "project_activity_delete" on public.project_activity for delete using (
  get_my_role() = 'admin'
);

grant select, insert on public.project_activity to authenticated;
grant delete on public.project_activity to authenticated;

-- ── 2. RFI privacy ──────────────────────────────────────────
-- Old external branch: any non-archived RFI on a team project.
-- New external branch: team membership still required, PLUS the
-- RFI must be public, or created by / assigned to the user.
drop policy if exists "rfis_select" on public.rfis;
create policy "rfis_select" on public.rfis for select using (
  get_my_role() in ('admin','internal','pricing')
  or (
    (archived = false or archived is null)
    and exists (
      select 1 from public.projects p
      where p.id = rfis.project_id
        and p.team @> jsonb_build_array(jsonb_build_object('user_email',
              (select email from public.users where id = auth.uid())))
    )
    and (
      is_public = true
      or created_by_id = auth.uid()
      or created_by_email  = (select email from public.users where id = auth.uid())
      or assigned_to_email = (select email from public.users where id = auth.uid())
      or assignees @> jsonb_build_array(jsonb_build_object('email',
            (select email from public.users where id = auth.uid())))
    )
  )
);

-- ── 3. Task policies: add pricing ───────────────────────────
drop policy if exists "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update using (
  get_my_role() in ('admin','internal','pricing')
  or created_by_id = auth.uid()
  or assignee_email = (select email from public.users where id = auth.uid())
);
drop policy if exists "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks for delete using (
  get_my_role() in ('admin','internal','pricing')
);

-- ── Optional backfill (leave commented unless wanted) ───────
-- Makes all pre-existing RFIs visible to external team members,
-- preserving pre-008 behaviour for historical RFIs only:
-- update public.rfis set is_public = true where created_at < now();

-- ── Verification ────────────────────────────────────────────
-- select count(*) from public.project_activity;                          -- 0, no error
-- select policyname from pg_policies where tablename = 'rfis';           -- rfis_select present
-- select policyname, qual from pg_policies where tablename = 'tasks';    -- pricing in all three
