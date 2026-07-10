-- 013: disabled flag on task_dependencies (engine keeps but ignores disabled links)
alter table public.task_dependencies
  add column if not exists is_disabled boolean not null default false;
