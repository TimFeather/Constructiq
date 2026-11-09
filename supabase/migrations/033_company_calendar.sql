-- ============================================================
-- Migration 033 — company_calendar (company-wide shutdowns + holidays)
-- Run in Supabase SQL Editor.
-- Safe to re-run.
--
-- Shutdowns and custom holidays used to live only on each programme
-- (programmes.calendar), so the Christmas close-down had to be entered on
-- every job. This single-row table holds the ones that apply to every
-- programme; the scheduler merges them with NZ public holidays and each
-- programme's own shutdowns/holidays (buildProjectCalendar).
--
-- Everyone signed in reads it (clients and subcontractors see the same
-- programme dates); only admins change it. There is exactly one row
-- (id = true), seeded here, so the app only ever updates it — no insert
-- or delete grant needed.
--
-- Until this runs, the app treats the company calendar as empty and
-- schedules exactly as before; saving company-wide settings fails with a
-- message pointing here.
-- ============================================================

create table if not exists public.company_calendar (
  id          boolean primary key default true check (id),   -- single row
  holidays    jsonb not null default '[]',                    -- ['yyyy-MM-dd', ...]
  shutdowns   jsonb not null default '[]',                    -- [{ start, end }, ...] yyyy-MM-dd
  updated_at  timestamptz not null default now()
);

insert into public.company_calendar (id) values (true) on conflict (id) do nothing;

alter table public.company_calendar enable row level security;

drop policy if exists "company_calendar_read" on public.company_calendar;
create policy "company_calendar_read" on public.company_calendar
  for select using (auth.uid() is not null);

drop policy if exists "company_calendar_write" on public.company_calendar;
create policy "company_calendar_write" on public.company_calendar
  for update using (get_my_role() = 'admin') with check (get_my_role() = 'admin');

-- Per README.md's grant checklist: RLS alone gives 42501.
grant select, update on public.company_calendar to authenticated;
grant select on public.company_calendar to service_role;

-- ============================================================
-- Verification (run after applying):
--
-- select * from public.company_calendar;
-- -- expect one row: id = true, holidays = [], shutdowns = []
--
-- select has_table_privilege('authenticated', 'public.company_calendar', 'SELECT') as auth_select,
--        has_table_privilege('authenticated', 'public.company_calendar', 'UPDATE') as auth_update;
-- -- expect true, true
--
-- select policyname from pg_policies where tablename = 'company_calendar';
-- -- expect company_calendar_read, company_calendar_write
-- ============================================================
