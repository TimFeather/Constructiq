-- ============================================================
-- Migration 026 — tender_submissions: provenance for manually
-- recorded (off-platform) pricing.
-- Run in Supabase SQL Editor. Safe to re-run.
--
-- Why: subcontractors often email a price directly instead of using
-- the portal, and the portal path is (correctly) closed once the
-- tender closes. Admins record those prices via the recordSubmission
-- edge function; these columns keep the resulting rows distinguishable
-- from genuine self-service submissions.
-- No new table -> no new grants needed; columns inherit the table
-- grants already held by authenticated/service_role.
-- ============================================================

alter table public.tender_submissions
  add column if not exists submission_source     text not null default 'portal',
  add column if not exists recorded_by_email     text,
  add column if not exists recorded_by_name      text,
  add column if not exists recorded_at           timestamptz,
  add column if not exists received_after_close  boolean not null default false;

-- Constraint added separately so re-running does not error on an existing one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tender_submissions_source_check'
  ) then
    alter table public.tender_submissions
      add constraint tender_submissions_source_check
      check (submission_source in ('portal','manual'));
  end if;
end $$;

-- ============================================================
-- Verification (run after applying):
--
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='tender_submissions'
--      and column_name in ('submission_source','recorded_by_email',
--                          'recorded_by_name','recorded_at','received_after_close');
--   -- expect 5 rows; submission_source default 'portal'
--
--   select submission_source, count(*) from public.tender_submissions group by 1;
--   -- expect every existing row to be 'portal'
--
--   select has_table_privilege('service_role','public.tender_submissions','INSERT') as svc_insert,
--          has_table_privilege('authenticated','public.tender_submissions','SELECT') as auth_select;
--   -- expect: t | t   (if either is false, STOP and tell Tim — grants are missing)
-- ============================================================
