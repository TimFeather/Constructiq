-- ════════════════════════════════════════════════════════════════════
-- Migration 021 — grants for the migration-020 email delivery tables
--
-- Same omission migration 007 had to fix for 006: 020 created the tables,
-- RLS policies and the view, but never GRANTed the Supabase API roles base
-- table privileges. This database does not have permissive default
-- privileges on public, so every request failed with
-- 42501 "permission denied for table email_messages" before RLS was even
-- evaluated — including the Settings → Emails panel and the invitee badge.
--
-- RLS (from 020) still decides which rows each role can see: staff-only
-- reads, all writes via edge functions on the service role.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- Read-only for signed-in staff; RLS narrows this to admin/pricing/internal.
grant select on
  public.email_messages,
  public.email_events
to authenticated;

-- The view is security_invoker, so it reads the base tables as the caller —
-- the grant above is what makes it work. Re-granted here for a fresh apply.
grant select on public.tender_invitee_delivery to authenticated;

-- Edge functions (resendWebhook, the send paths) write on the service role.
grant all on
  public.email_messages,
  public.email_events
to service_role;

-- ============================================================
-- Verification (run after applying):
--
-- select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--  where table_name in ('email_messages','email_events','tender_invitee_delivery')
--    and grantee in ('authenticated','service_role')
--  order by table_name, grantee, privilege_type;
-- -- expect SELECT for authenticated on all three,
-- --        full privileges for service_role on the two tables
-- ============================================================
