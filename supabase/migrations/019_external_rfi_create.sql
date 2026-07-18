-- ============================================================
-- Migration 019 — Allow subcontractors / external team members
-- to raise RFIs on projects they're on the team of.
-- Run in Supabase SQL Editor.
--
-- Previously rfis_insert only allowed admin/internal/pricing,
-- so externals (subcontractors, clients, etc.) could see and
-- respond to RFIs but never create one. This widens insert to
-- externals scoped to team membership on the target project,
-- matching the scoping already used by rfis_select (migration 008).
-- ============================================================

drop policy if exists "rfis_insert" on public.rfis;
create policy "rfis_insert" on public.rfis for insert with check (
  get_my_role() in ('admin','internal','pricing')
  or (
    get_my_role() = 'external'
    and exists (
      select 1 from public.projects p
      where p.id = rfis.project_id
        and p.team @> jsonb_build_array(jsonb_build_object('user_email',
              (select email from public.users where id = auth.uid())))
    )
  )
);

-- ============================================================
-- Verification (run after applying):
--
-- select policyname, qual, with_check from pg_policies
--   where tablename = 'rfis' and policyname = 'rfis_insert';
-- -- confirm with_check includes the 'external' + team-membership branch
-- ============================================================
