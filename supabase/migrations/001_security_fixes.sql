-- ============================================================
-- Migration 001 — Critical Security Fixes
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ── A1: Replace open-read policy on tender_invitations ──────
-- The old policy (FOR SELECT USING (true)) exposes all invitation
-- tokens and invitee emails to unauthenticated callers via REST.
-- tenderPublicApi uses SERVICE_ROLE_KEY so it bypasses RLS — this
-- change does NOT break the public submission portal.

drop policy if exists "tender_invitations_public_read" on public.tender_invitations;

create policy "tender_invitations_internal_read" on public.tender_invitations
  for select using (get_my_role() in ('admin', 'pricing', 'internal'));


-- ── A2: Remove open-insert policy on tender_submissions ─────
-- The old policy (FOR INSERT WITH CHECK (true)) allows any
-- unauthenticated caller to insert fake submissions. All legitimate
-- submission inserts go through the tenderPublicApi edge function
-- (service role), which bypasses RLS. No functionality is lost.

drop policy if exists "tender_submissions_public_insert" on public.tender_submissions;


-- ── B1: Add missing indexes on FK columns ───────────────────
-- Every page load filters by these columns. Without indexes,
-- PostgREST does full table scans.

create index if not exists idx_tender_invitees_tender_id      on public.tender_invitees(tender_id);
create index if not exists idx_tender_invitations_tender_id   on public.tender_invitations(tender_id);
create index if not exists idx_tender_invitations_invitee_id  on public.tender_invitations(invitee_id);
create index if not exists idx_tender_submissions_tender_id   on public.tender_submissions(tender_id);
create index if not exists idx_documents_project_id           on public.documents(project_id);
create index if not exists idx_rfis_project_id                on public.rfis(project_id);
create index if not exists idx_tasks_project_id               on public.tasks(project_id);
create index if not exists idx_pending_assignments_email      on public.pending_project_assignments(email, status);
create index if not exists idx_invited_users_email            on public.invited_users(email);

-- Note: tender_activity vs tender_activities — verify exact table name before running:
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'tender_activ%';
-- Then uncomment the correct line:
-- create index if not exists idx_tender_activity_tender_id on public.tender_activity(tender_id);
-- create index if not exists idx_tender_activities_tender_id on public.tender_activities(tender_id);


-- ── B2: Fix tender_invitees constraints ─────────────────────
-- Add NOT NULL on full_name and a unique index to prevent
-- duplicate email invitations on the same tender.

alter table public.tender_invitees alter column full_name set not null;

create unique index if not exists uq_tender_invitees_tender_email
  on public.tender_invitees(tender_id, lower(email))
  where email is not null;


-- ── B3: Fix projects status CHECK constraint ─────────────────
-- Add 'Archived' so project archiving feature (Phase 6) can work.

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('Active', 'On Hold', 'Complete', 'Archived'));
