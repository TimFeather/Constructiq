-- ============================================================
-- Migration 031 — lock closed projects to admins
-- Run in Supabase SQL Editor.
-- Safe to re-run.
--
-- A project is CLOSED when its status is 'Complete' or 'Archived'. Only
-- admins can see or change a closed project or anything inside it: tasks,
-- programme, documents, RFIs, CIs, activity and stored files. Everyone
-- else, including the person who created it, loses access until an admin
-- reopens it. 'On Hold' stays open to the whole team.
--
-- The team list is left alone, so reopening restores everyone's access.
--
-- Running this locks every project that is already Complete or Archived.
--
-- How it's enforced:
--   * RESTRICTIVE policies, which AND onto the existing permissive policies
--     rather than replacing them. The existing role/team rules are untouched.
--   * set_project_status() is how status changes. Postgres also checks the
--     SELECT policy against the new row of an UPDATE, so a non-admin can no
--     longer close a project with a direct UPDATE: the row they're writing
--     would be one they can't see. The function runs as owner, applies the
--     same who-may-edit rule as projects_update, and logs the change itself
--     because the caller may not be able to write to the activity feed
--     afterwards. Only admins can reopen.
--   * publish_programme()/unpublish_programme() are security definer and skip
--     RLS, so programmes also gets a trigger.
--   * Edge functions use the service role and skip all of this.
--     notifyRfiAssigned and notifyProgrammePublished check status themselves.
--
-- task_baseline_items has no project_id. Its SELECT policy goes through
-- task_baselines, so reads are covered by the policy on that table.
--
-- Grants: no new tables. New functions are granted below.
-- ============================================================

-- ── 1. Which projects are closed ─────────────────────────────
-- Security definer because a policy on a child table has to see the closed
-- projects that projects_select now hides from the caller. Returns an array so
-- policies can call it once per statement as (select closed_project_ids()).
create or replace function public.closed_project_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(id), '{}'::uuid[])
  from public.projects
  where status in ('Complete', 'Archived');
$$;

revoke execute on function public.closed_project_ids() from public, anon;
grant execute on function public.closed_project_ids() to authenticated, service_role;

-- ── 2. Lock the projects table ───────────────────────────────
drop policy if exists "projects_closed_guard" on public.projects;
create policy "projects_closed_guard" on public.projects
  as restrictive
  for all
  to authenticated
  using (
    (select public.get_my_role()) = 'admin'
    or status not in ('Complete', 'Archived')
  )
  with check (
    (select public.get_my_role()) = 'admin'
    or status not in ('Complete', 'Archived')
  );

-- ── 3. Lock everything inside a closed project ───────────────
-- project_id is null on some email_messages/audit_logs/documents rows that
-- don't belong to a project; those aren't affected.
do $$
declare
  t text;
  pred text := $p$
    (select public.get_my_role()) = 'admin'
    or project_id is null
    or not (project_id = any ((select public.closed_project_ids())::uuid[]))
  $p$;
begin
  foreach t in array array[
    'tasks', 'task_dependencies', 'task_baselines', 'task_change_log',
    'task_progress_log', 'programmes', 'documents', 'rfis',
    'contract_instructions', 'project_activity', 'email_messages', 'audit_logs'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_closed_guard', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      t || '_closed_guard', t, pred, pred
    );
  end loop;
end;
$$;

-- ── 4. Lock stored files ─────────────────────────────────────
-- project-files paths are flat (<timestamp>-<uuid>.<ext>) and carry no project
-- id, and the bucket lets any signed-in user sign any path. Without this a
-- contractor who kept a file's path could still download it. A link signed
-- before the project closed keeps working until it expires (1 hour).
create or replace function public.project_file_is_closed(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with closed as (
    select unnest(public.closed_project_ids()) as id
  )
  select
    exists (
      select 1 from public.documents d
      where d.project_id in (select id from closed)
        and (position(p_path in d.file_url) > 0
             or position(p_path in coalesce(d.versions::text, '')) > 0)
    )
    or exists (
      select 1 from public.rfis r
      where r.project_id in (select id from closed)
        and (position(p_path in coalesce(r.attachments::text, '')) > 0
             or position(p_path in coalesce(r.responses::text, '')) > 0)
    )
    or exists (
      select 1 from public.contract_instructions c
      where c.project_id in (select id from closed)
        and position(p_path in coalesce(c.attachments::text, '')) > 0
    )
    or exists (
      select 1 from public.task_progress_log l
      where l.project_id in (select id from closed)
        and l.photo_path = p_path
    )
    or exists (
      select 1 from public.project_activity a
      where a.project_id in (select id from closed)
        and position(p_path in coalesce(a.metadata::text, '')) > 0
    );
$$;

revoke execute on function public.project_file_is_closed(text) from public, anon;
grant execute on function public.project_file_is_closed(text) to authenticated, service_role;

drop policy if exists "project_files_closed_guard" on storage.objects;
create policy "project_files_closed_guard" on storage.objects
  as restrictive
  for select
  to authenticated
  using (
    bucket_id <> 'project-files'
    or (select public.get_my_role()) = 'admin'
    or not public.project_file_is_closed(name)
  );

-- ── 5. Publish/unpublish can't touch a closed programme ──────
-- get_my_role() is null for the service role and the SQL editor, which are
-- allowed through.
create or replace function public.block_closed_programme_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
begin
  if v_role is not null and v_role <> 'admin'
     and new.project_id = any (closed_project_ids()) then
    raise exception 'This project is closed. An admin must reopen it first.';
  end if;
  return new;
end;
$$;

drop trigger if exists programmes_closed_guard on public.programmes;
create trigger programmes_closed_guard
  before update on public.programmes
  for each row execute function public.block_closed_programme_update();

-- ── 6. Changing status ───────────────────────────────────────
create or replace function public.set_project_status(p_project_id uuid, p_status text)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := get_my_role();
  v_email   text;
  v_name    text;
  v_project public.projects;
  v_old     text;
begin
  if p_status is null or p_status not in ('Active', 'On Hold', 'Complete', 'Archived') then
    raise exception 'Invalid project status: %', p_status;
  end if;

  select email, coalesce(nullif(trim(full_name), ''), email)
    into v_email, v_name
    from public.users
   where id = v_uid;

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Project not found';
  end if;

  -- Same rule as the projects_update policy. coalesce because a project with no
  -- created_by_id makes this null, and "if not null" would let the caller through.
  if not coalesce(
    v_role = 'admin'
    or v_project.created_by_id = v_uid
    or (v_role = 'internal'
        and v_project.team @> jsonb_build_array(jsonb_build_object('user_email', v_email))),
    false
  ) then
    raise exception 'You do not have permission to change this project''s status';
  end if;

  if v_project.status in ('Complete', 'Archived') and v_role <> 'admin' then
    raise exception 'Only an admin can reopen a closed project';
  end if;

  v_old := v_project.status;
  if v_old is not distinct from p_status then
    return v_project;
  end if;

  -- archive_project_children (trigger) still flags child records on Archived.
  update public.projects
     set status = p_status, updated_at = now()
   where id = p_project_id
  returning * into v_project;

  insert into public.project_activity
    (project_id, entity_type, event_type, actor_name, actor_email, description, metadata, occurred_at)
  values
    (p_project_id, 'project', 'status_changed', coalesce(v_name, 'System'), coalesce(v_email, ''),
     format('Status changed from %s to %s', v_old, p_status),
     jsonb_build_object('from', v_old, 'to', p_status), now());

  return v_project;
end;
$$;

revoke execute on function public.set_project_status(uuid, text) from public, anon;
grant execute on function public.set_project_status(uuid, text) to authenticated, service_role;
