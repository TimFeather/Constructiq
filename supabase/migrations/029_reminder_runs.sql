-- ════════════════════════════════════════════════════════════════════
-- Migration 029 — reminder_runs (run visibility for sendReminders)
-- Run in Supabase SQL Editor.
--
-- A sendReminders invocation that sends nothing currently leaves no
-- trace anywhere. A dead cron job and a quiet week where nothing was
-- due look identical from the outside — which is exactly how the
-- reminders going silent since June went unnoticed. This table gives
-- every invocation a row, sent or not, so "Last run" in Settings can
-- tell the two cases apart.
--
-- One row per invocation, written at the end of every run — including
-- the failure path — by sendReminders/index.ts. `trigger` distinguishes
-- pg_cron (service-role key) from a manual "Run now" click in Settings.
--
-- Per README.md's grant checklist (three prior outages — 006/007,
-- 020/021, and 023 which is *this same function* — all from a missing
-- grant): both service_role (the edge function's insert) and
-- authenticated (the Settings panel's read, scoped by RLS below) are
-- granted explicitly, in this same file, not a follow-up one.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.reminder_runs (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  trigger     text not null,          -- 'cron' | 'manual'
  sent        int  not null default 0,
  skipped     int  not null default 0,
  error       text,
  details     jsonb
);

create index if not exists idx_reminder_runs_ran_at on public.reminder_runs(ran_at desc);

alter table public.reminder_runs enable row level security;

-- Read-only for admins (mirrors reminder_log_admin). All writes go
-- through sendReminders on the service role key, which bypasses RLS.
create policy "reminder_runs_admin" on public.reminder_runs for all using (
  get_my_role() = 'admin'
);

grant select, insert on public.reminder_runs to authenticated;
grant select, insert on public.reminder_runs to service_role;

-- ============================================================
-- Verification (run after applying):
--
-- select c.relname,
--        has_table_privilege('service_role',  c.oid, 'SELECT') as sr_select,
--        has_table_privilege('service_role',  c.oid, 'INSERT') as sr_insert,
--        has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relname = 'reminder_runs';
-- -- expect true for all three
--
-- select policyname from pg_policies where tablename = 'reminder_runs';
-- -- expect reminder_runs_admin
-- ============================================================
