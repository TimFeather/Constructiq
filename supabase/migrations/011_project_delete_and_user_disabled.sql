-- 011_project_delete_and_user_disabled.sql
--
-- Fixes two bugs:
-- 1) Deleting a project 409s when a tender references it (or a
--    pending_project_assignments row references it) because the FKs to
--    projects(id) have no ON DELETE behaviour (default RESTRICT).
-- 2) Users cannot be deactivated because there is no `disabled` column on
--    public.users (the app writes User.update(id, { disabled: true }) but
--    that column has never existed).
--
-- Run this once in the Supabase SQL Editor.

begin;

-- 1a. tenders.project_id — tender history must survive project deletion.
--     Find the auto-generated constraint name first if this fails:
--       select conname from pg_constraint where conrelid = 'public.tenders'::regclass and contype = 'f';
alter table public.tenders drop constraint if exists tenders_project_id_fkey;
alter table public.tenders
  add constraint tenders_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

-- 1b. tenders.converted_project_id — same reasoning.
alter table public.tenders drop constraint if exists tenders_converted_project_id_fkey;
alter table public.tenders
  add constraint tenders_converted_project_id_fkey
  foreign key (converted_project_id) references public.projects(id) on delete set null;

-- 1c. pending_project_assignments.project_id — an assignment is meaningless
--     without the project it was assigning someone to, so cascade.
alter table public.pending_project_assignments drop constraint if exists pending_project_assignments_project_id_fkey;
alter table public.pending_project_assignments
  add constraint pending_project_assignments_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete cascade;

-- 2. Add the missing deactivation column. RLS is already sufficient:
--    users_update_admin lets any admin update any row.
alter table public.users add column if not exists disabled boolean not null default false;

commit;
