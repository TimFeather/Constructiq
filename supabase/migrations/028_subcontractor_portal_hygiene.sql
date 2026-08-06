-- ============================================================
-- Migration 028 — subcontractor portal hygiene (optional)
-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Not required for the "My Tenders" feature to work — every table it touches
-- is already readable/writable by the service-role functions involved. This
-- is pure hygiene found along the way:
--
-- 1. tenderPublicApi's `get` action filters tender_submissions by
--    invitation_id on every single portal load (logged-out AND now the
--    authenticated subcontractorPortal/listMine path), and there was no
--    index backing that filter.
-- 2. Some tender_invitations.invitee_email values carry leading/trailing
--    whitespace from manual entry. subcontractorPortal/listMine already
--    tolerates this (.ilike prefilter + JS lower(trim()) verify), so this
--    is belt-and-braces, not a fix for a live bug.
--
-- Deliberately NOT adding an index on lower(btrim(invitee_email)): Postgres
-- cannot use a lower()-expression index to satisfy an ILIKE predicate (would
-- need lower(col) = lower(val), which PostgREST can't express here, or a
-- pg_trgm index — a new extension for no real gain at this data volume).
-- ============================================================

-- 1. Index the FK tenderPublicApi's `get` filters on every load.
create index if not exists idx_tender_submissions_invitation_id
  on public.tender_submissions (invitation_id);

-- 2. Non-destructive: trim whitespace-mismatched invitee_email values.
update public.tender_invitations
   set invitee_email = btrim(invitee_email)
 where invitee_email is distinct from btrim(invitee_email);

-- ============================================================
-- Verification (run after applying):
--
--   select indexname from pg_indexes
--   where schemaname = 'public' and tablename = 'tender_submissions'
--   and indexname = 'idx_tender_submissions_invitation_id';
--   -- expect one row
--
--   select count(*) from public.tender_invitations
--   where invitee_email is distinct from btrim(invitee_email);
--   -- expect 0
-- ============================================================
