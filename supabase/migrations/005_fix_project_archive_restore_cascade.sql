-- Bug fix: archiving a project cascades `archived = true` to its documents, rfis,
-- tasks, and contract_instructions, but restoring the project (status away from
-- 'Archived') never reversed it — those child records stayed archived forever.
-- This makes the cascade symmetric in both directions.
create or replace function public.archive_project_children()
returns trigger as $$
begin
  if new.status = 'Archived' and old.status != 'Archived' then
    update documents              set archived = true, archived_at = now() where project_id = new.id;
    update rfis                   set archived = true where project_id = new.id;
    update tasks                  set archived = true where project_id = new.id;
    update contract_instructions  set archived = true where project_id = new.id;
  elsif old.status = 'Archived' and new.status != 'Archived' then
    update documents              set archived = false, archived_at = null where project_id = new.id;
    update rfis                   set archived = false where project_id = new.id;
    update tasks                  set archived = false where project_id = new.id;
    update contract_instructions  set archived = false where project_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;
