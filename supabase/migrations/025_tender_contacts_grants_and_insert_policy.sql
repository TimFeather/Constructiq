-- ============================================================
-- Migration 025 — tender_contacts: grants + INSERT policy
-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Why: tender_contacts (the Settings -> Subcontractors directory)
-- was created in schema.sql with RLS + select/update/delete
-- policies but NO explicit grants and NO insert policy. The client
-- "Add Contact" POST /tender_contacts?select=* saves the row but
-- the return-representation step 403s; the service_role directory
-- sync from job invites (upsertTenderContact) can also fail
-- silently -- BYPASSRLS skips row policies, not table grants.
-- This table was missed by the 023 grant audit.
-- ============================================================

-- 1. Table grants (README template; re-granting is a no-op).
grant select, insert, update, delete on public.tender_contacts to authenticated;
grant all on public.tender_contacts to service_role;

-- 2. Ensure the INSERT policy exists (mirrors tender_contacts_select /
--    _update and the working project_activity_insert). Drop-then-
--    create keeps it idempotent.
drop policy if exists "tender_contacts_insert" on public.tender_contacts;
create policy "tender_contacts_insert" on public.tender_contacts for insert with check (
  get_my_role() in ('admin','pricing','internal')
);

-- ============================================================
-- Verification (run after applying):
--
--   select
--     has_table_privilege('authenticated','public.tender_contacts','SELECT') as auth_select,
--     has_table_privilege('authenticated','public.tender_contacts','INSERT') as auth_insert,
--     has_table_privilege('service_role', 'public.tender_contacts','INSERT') as svc_insert;
--   -- expect: t | t | t
--
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'tender_contacts'
--   order by policyname;
--   -- expect a tender_contacts_insert | INSERT row alongside select/update/delete
-- ============================================================
