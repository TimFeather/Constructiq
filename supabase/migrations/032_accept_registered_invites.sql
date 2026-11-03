-- ============================================================
-- Migration 032 — close out invitations for people who already registered
-- Run in Supabase SQL Editor.
-- Safe to re-run.
--
-- Settings → People → Pending Invitations listed 31 people (as of 2026-11-03)
-- who had registered and signed in, some months ago. processPendingAssignments
-- marks an invite Accepted on first sign-in, but Login/Register redirected
-- before that call finished, and invites with no project assignment were
-- skipped outright. Both are fixed in code (AuthContext +
-- processPendingAssignments); this clears the backlog they left.
--
-- Only confirmed accounts count as registered. An unconfirmed one (stranded by
-- the old verify-link flow) can't sign in, so its invite stays Pending and can
-- still be resent — registerInvited completes the account from the new link.
-- ============================================================

-- 1. Their project assignments. Everyone affected was put on the project team
--    when invited, so these only need closing out. Anyone not on the team yet is
--    left Pending for processPendingAssignments to add on their next sign-in.
update public.pending_project_assignments p
set status = 'Activated'
from auth.users a, public.projects pr
where p.status = 'Pending'
  and lower(a.email) = lower(p.email)
  and a.email_confirmed_at is not null
  and pr.id = p.project_id
  and exists (
    select 1 from jsonb_array_elements(coalesce(pr.team, '[]'::jsonb)) m
    where lower(m->>'user_email') = lower(p.email)
  );

-- 2. The invites. Skips any whose invited role the account never got, so that
--    the next sign-in applies it (processPendingAssignments never downgrades).
--    None at time of writing — every stuck invite was external.
update public.invited_users i
set status = 'Accepted'
from auth.users a
join public.users u on u.id = a.id
where i.status = 'Pending'
  and lower(a.email) = lower(i.email)
  and a.email_confirmed_at is not null
  and lower(coalesce(nullif(i.app_role, ''), 'external')) in ('external', u.role);

-- ============================================================
-- Verification (run after applying):
--   select i.email from invited_users i
--   join auth.users a on lower(a.email) = lower(i.email)
--   where i.status = 'Pending' and a.email_confirmed_at is not null;
--   → no rows. Pending Invitations then shows only people with no working
--     account (10 at time of writing, incl. karl@cfg.org.nz, unconfirmed).
-- ============================================================
