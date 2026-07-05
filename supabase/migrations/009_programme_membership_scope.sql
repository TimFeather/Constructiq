-- ============================================================
-- Migration 009 — Scope programme reads to team membership;
-- make external users read-only on tasks.
-- Run in Supabase SQL Editor.
--
-- Two problems fixed:
--
-- 1. 'internal' has org-wide read access to projects/tasks/
--    programmes/baselines/change-log (get_my_role() in
--    ('admin','internal','pricing') see-all clause). Internal
--    users should only see projects they created or are on the
--    team[] of — same rule external already partially had.
--    Pricing keeps org-wide visibility (tender/cross-project need).
--
-- 2. tasks_update (migration 008) added
--      created_by_id = auth.uid() OR assignee_email = me
--    with no role check, so an external user assigned to a task
--    (or who created one, if that's ever possible) can write to
--    it directly via the API. External must be strictly read-only.
--    This removes that escape hatch — only admin/internal/pricing
--    may update tasks now.
--
-- SAFE — the frontend (Programme.jsx, TaskProgressPanel,
-- TaskInlineEditor) already gates all of these actions in the UI
-- as of this migration; this makes the DB the authoritative layer.
-- ============================================================

-- ── projects: drop 'internal' from the see-all clause ─────────
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects for select using (
  get_my_role() in ('admin', 'pricing')
  or created_by_id = auth.uid()
  or (
    team @> jsonb_build_array(
      jsonb_build_object(
        'user_email',
        (select email from public.users where id = auth.uid())
      )
    )
  )
);

-- ── tasks: select scoped to membership; update role-restricted ─
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks for select using (
  get_my_role() in ('admin', 'pricing')
  or exists (
       select 1 from public.projects p
       where p.id = tasks.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);

drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks for update using (
  get_my_role() in ('admin', 'internal', 'pricing')
);

-- ── programmes: drop 'internal' from the see-all clause ────────
drop policy if exists "programmes_select" on public.programmes;
create policy "programmes_select" on public.programmes for select using (
  get_my_role() in ('admin', 'pricing')
  or exists (
       select 1 from public.projects p
       where p.id = programmes.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);

-- ── task_dependencies: drop 'internal' from the see-all clause ─
drop policy if exists "task_dependencies_select" on public.task_dependencies;
create policy "task_dependencies_select" on public.task_dependencies for select using (
  get_my_role() in ('admin', 'pricing')
  or exists (
       select 1 from public.projects p
       where p.id = task_dependencies.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);

-- ── task_baselines: drop 'internal' from the see-all clause ────
drop policy if exists "task_baselines_select" on public.task_baselines;
create policy "task_baselines_select" on public.task_baselines for select using (
  get_my_role() in ('admin', 'pricing')
  or exists (
       select 1 from public.projects p
       where p.id = task_baselines.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);

-- ── task_progress_log: drop 'internal' from the see-all clause ─
drop policy if exists "task_progress_log_select" on public.task_progress_log;
create policy "task_progress_log_select" on public.task_progress_log for select using (
  get_my_role() in ('admin', 'pricing')
  or exists (
       select 1 from public.projects p
       where p.id = task_progress_log.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);

-- ── task_change_log: drop 'internal' from the see-all clause ───
drop policy if exists "task_change_log_select" on public.task_change_log;
create policy "task_change_log_select" on public.task_change_log for select using (
  get_my_role() in ('admin', 'pricing')
  or exists (
       select 1 from public.projects p
       where p.id = task_change_log.project_id
       and (p.created_by_id = auth.uid()
            or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);

-- ============================================================
-- Verification (run after applying):
--
-- select policyname, qual from pg_policies
--   where tablename in ('projects','tasks','programmes',
--     'task_dependencies','task_baselines','task_progress_log','task_change_log')
--   and policyname like '%select%'
--   order by tablename;
-- -- confirm none of the qual strings contain 'internal' any more
--
-- select policyname, qual from pg_policies
--   where tablename = 'tasks' and policyname = 'tasks_update';
-- -- confirm it reads: get_my_role() in ('admin', 'internal', 'pricing')
-- -- with no created_by_id / assignee_email clause
-- ============================================================
