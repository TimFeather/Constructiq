-- 018: optional client details on projects
alter table public.projects add column if not exists client_name text;
alter table public.projects add column if not exists client_address text;
alter table public.projects add column if not exists client_phone text;
