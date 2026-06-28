-- ============================================================
-- Migration 003 — Scope projects_select to team membership
-- Run in Supabase SQL Editor. Audit item #1 (2026-06-28).
--
-- Current policy: USING (auth.uid() IS NOT NULL)
-- → any logged-in user reads ALL projects + full team[] JSONB
-- → with open self-registration, anyone on internet can read
--   every member's email/phone/business via the team[] array.
--
-- Fix: admin/internal/pricing see all (needed for cross-project
-- views); external see only projects where their email is in
-- team[] OR they are the creator.
--
-- SAFE — all three consumer pages (Projects, Documents, RFIs)
-- already do identical frontend filtering for non-admin users.
-- This makes the DB the authoritative layer instead of relying
-- solely on the client-side filter.
--
-- tasks_select for external users does an EXISTS on projects
-- with the same team @> pattern — that continues to work for
-- team members because they CAN see those projects under this
-- policy. Non-members correctly lose access to both.
-- ============================================================

drop policy if exists "projects_select" on public.projects;

create policy "projects_select" on public.projects for select using (
  get_my_role() in ('admin', 'internal', 'pricing')
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
