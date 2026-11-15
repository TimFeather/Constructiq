-- ============================================================
-- Migration 034 — security hardening (audit 2026-11-16, items 1–5)
-- Run in Supabase SQL Editor, top to bottom, in one go.
-- Safe to re-run.
--
-- What changes for people using the app: nothing, unless they are
-- deactivated or were relying on one of the holes below.
--
--   1. Documents bucket: nobody outside staff can LIST it any more.
--      The bucket stays public, so every tender / NTT / logo link that
--      has already been emailed keeps opening with no login.
--   2. Deactivating a user is now enforced by the database, not just the
--      browser, and a user can no longer flip their own `disabled` flag.
--   3. Stored files: only staff can write/delete freely. Subcontractors
--      and clients can still upload (RFI attachments), remove their own
--      upload, and open any file that belongs to a record they can see.
--   4. Invitation tokens are readable/editable by admins only.
--   5. publish_programme / unpublish_programme reject callers with no
--      role (they used to let them through) and are no longer callable
--      without signing in.
--
-- Deploy order: this file is independent of the code. Run it any time.
-- The matching invitationService change (non-admins can't hand out the
-- admin role) ships separately via `npm run deploy:functions`.
--
-- Grants: no new tables. New functions are granted below.
--
-- NEW TABLES AFTER THIS: section 2c adds an "<table>_active_guard"
-- policy to every table that exists today. A table created later needs
-- its own (copy the one-liner from 2c), same as the closed-project guard
-- from 031.
-- ============================================================


-- All or nothing: if any statement fails, nothing is changed. Without this,
-- a failure part-way through the storage section could leave the old file
-- policies dropped and the new ones missing.
begin;

-- ════════════════════════════════════════════════════════════
-- 2. Deactivated users
-- ════════════════════════════════════════════════════════════

-- ── 2a. get_my_role() reports 'disabled' for a deactivated user ──
-- Every policy compares the role with = or IN, so 'disabled' matches
-- nothing and fails closed. Function guards written as
-- "role <> 'admin' → refuse" also refuse it. Returning NULL instead
-- would not be safe: NULL means "service role / SQL editor" to the
-- triggers from 031 and is let through.
-- No account, or not signed in: still NULL, as before.
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when disabled then 'disabled' else role end
  from public.users
  where id = auth.uid()
$$;

-- ── 2b. A user can't change their own `disabled` flag ────────
-- Same policy as migration 002, plus the `disabled` pin. The subqueries
-- read the row as it was before the update. Admins change other people
-- through users_update_admin, which is untouched.
drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role     = (select role     from public.users where id = auth.uid())
    and email    = (select email    from public.users where id = auth.uid())
    and disabled = (select disabled from public.users where id = auth.uid())
  );

-- ── 2c. Deactivated users are locked out of every table ──────
-- The role check in 2a doesn't cover policy branches that aren't about
-- role ("I created this", "I'm on the team"). A deactivated user's
-- access token stays valid for up to an hour, so without this they could
-- keep reading their projects through those branches.
--
-- Security definer because it runs inside policies on public.users.
-- True for anyone who isn't flagged, including someone with no profile
-- row yet, so nothing changes for active users.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.users where id = auth.uid() and disabled
  );
$$;

revoke execute on function public.is_active_user() from public, anon;
grant  execute on function public.is_active_user() to authenticated, service_role;

-- RESTRICTIVE: ANDs onto the existing policies, replaces none of them.
-- public.users is handled separately so a deactivated user can still
-- read their own row. That's how the app shows "Account deactivated".
do $$
declare
  t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and c.relname <> 'users'
    order by c.relname
  loop
    execute format('drop policy if exists %I on public.%I', t || '_active_guard', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      || 'using ((select public.is_active_user())) '
      || 'with check ((select public.is_active_user()))',
      t || '_active_guard', t
    );
  end loop;
end;
$$;

drop policy if exists "users_active_guard" on public.users;
create policy "users_active_guard" on public.users
  as restrictive
  for update
  to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

-- ── 2d. Deactivating also blocks sign-in and ends sessions ───
-- Flipping `disabled` (Settings → People → Deactivate) now also bans the
-- login and deletes the user's sessions, so edge functions stop
-- accepting their token straight away. Reactivating lifts the ban.
--
-- Best effort on purpose: if Supabase ever stops letting this role touch
-- the auth schema, the deactivation itself must still save. 2a–2c do not
-- depend on this step.
create or replace function public.sync_user_disabled_to_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.disabled is not distinct from old.disabled then
    return new;
  end if;

  begin
    if new.disabled then
      update auth.users
         set banned_until = now() + interval '100 years'
       where id = new.id;
      delete from auth.sessions where user_id = new.id;
    else
      update auth.users set banned_until = null where id = new.id;
    end if;
  exception when others then
    raise warning 'sync_user_disabled_to_auth: could not update auth for user %: %',
      new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.sync_user_disabled_to_auth() from public, anon, authenticated;

drop trigger if exists users_sync_disabled_to_auth on public.users;
create trigger users_sync_disabled_to_auth
  after update of disabled on public.users
  for each row execute function public.sync_user_disabled_to_auth();


-- ════════════════════════════════════════════════════════════
-- 1 + 3. Stored files
-- ════════════════════════════════════════════════════════════

-- ── Documents bucket (tender documents, NTT attachments, logos) ──
-- The bucket is PUBLIC and stays public: a file opens from its URL with
-- no policy involved. "public can read" only added the ability to LIST
-- and search the bucket, for anyone on the internet. File names are
-- <timestamp>-<random uuid>, so without listing they can't be found.
--
-- Uploads come only from staff screens (tender documents, NTT, logo
-- settings). Subcontractor pricing uploads go through tenderPublicApi
-- into the separate tender-submissions bucket and are not affected.
drop policy if exists "public can read"          on storage.objects;
drop policy if exists "authenticated can upload" on storage.objects;
drop policy if exists "authenticated can update" on storage.objects;
drop policy if exists "authenticated can delete" on storage.objects;

drop policy if exists "documents_staff_select" on storage.objects;
create policy "documents_staff_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'Documents'
    and (select public.get_my_role()) in ('admin', 'pricing', 'internal')
  );

drop policy if exists "documents_staff_insert" on storage.objects;
create policy "documents_staff_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'Documents'
    and (select public.get_my_role()) in ('admin', 'pricing', 'internal')
  );

drop policy if exists "documents_staff_update" on storage.objects;
create policy "documents_staff_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'Documents'
    and (select public.get_my_role()) in ('admin', 'pricing', 'internal')
  )
  with check (
    bucket_id = 'Documents'
    and (select public.get_my_role()) in ('admin', 'pricing', 'internal')
  );

drop policy if exists "documents_staff_delete" on storage.objects;
create policy "documents_staff_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'Documents'
    and (select public.get_my_role()) in ('admin', 'pricing', 'internal')
  );

-- ── project-files bucket (private; everything is opened by signed URL) ──
-- Can the caller see a record that points at this file? Runs as the
-- CALLER (not security definer), so the existing policies on documents,
-- rfis, contract_instructions and task_progress_log decide. A file is
-- visible exactly when the row that lists it is. Paths are matched the
-- same way as project_file_is_closed() in 031.
-- High cost so Postgres tries the cheap role/owner checks first.
create or replace function public.project_file_visible(p_path text)
returns boolean
language sql
stable
cost 5000
set search_path = public
as $$
  select p_path is not null and p_path <> '' and (
    exists (
      select 1 from public.task_progress_log l
      where l.photo_path = p_path
    )
    or exists (
      select 1 from public.documents d
      where position(p_path in coalesce(d.file_url, '')) > 0
         or position(p_path in coalesce(d.versions::text, '')) > 0
    )
    or exists (
      select 1 from public.rfis r
      where position(p_path in coalesce(r.attachments::text, '')) > 0
         or position(p_path in coalesce(r.responses::text, '')) > 0
    )
    or exists (
      select 1 from public.contract_instructions c
      where position(p_path in coalesce(c.attachments::text, '')) > 0
    )
  );
$$;

revoke execute on function public.project_file_visible(text) from public, anon;
grant  execute on function public.project_file_visible(text) to authenticated, service_role;

drop policy if exists "project_files_select" on storage.objects;
drop policy if exists "project_files_insert" on storage.objects;
drop policy if exists "project_files_update" on storage.objects;
drop policy if exists "project_files_delete" on storage.objects;

-- Read (needed to sign a URL):
--   staff    — any file (the closed-project guard from 031 still applies)
--   external — a file they uploaded, or one attached to a record they can see
create policy "project_files_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-files'
    and (
      (select public.get_my_role()) in ('admin', 'pricing', 'internal')
      or (
        (select public.get_my_role()) = 'external'
        and (
          owner_id = (select auth.uid())::text
          or public.project_file_visible(name)
        )
      )
    )
  );

-- Upload: any active user. Externals attach files to RFIs and responses.
create policy "project_files_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and (select public.get_my_role()) in ('admin', 'pricing', 'internal', 'external')
  );

-- Replace in place: staff only. The app never does this (uploads always
-- get a fresh name), so this is a backstop.
create policy "project_files_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'project-files'
    and (select public.get_my_role()) in ('admin', 'pricing', 'internal')
  )
  with check (
    bucket_id = 'project-files'
    and (select public.get_my_role()) in ('admin', 'pricing', 'internal')
  );

-- Delete: staff, or an external removing their own upload (the app does
-- this to roll back an upload when the save that follows it fails).
create policy "project_files_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-files'
    and (
      (select public.get_my_role()) in ('admin', 'pricing', 'internal')
      or (
        (select public.get_my_role()) = 'external'
        and owner_id = (select auth.uid())::text
      )
    )
  );


-- ════════════════════════════════════════════════════════════
-- 4. Invitation tokens
-- ════════════════════════════════════════════════════════════
-- An invite token creates the account for that email with whatever
-- password the holder types (registerInvited), and the account gets the
-- invite's app_role. Internal and pricing users could read every token
-- and edit every column, including app_role.
--
-- The only screen that reads this table is Settings → People → Pending
-- Invitations, which is admin-only. Everything else (inviting from a
-- project, resending, cancelling) goes through the invitationService
-- edge function with the service role and is not affected.
drop policy if exists "invited_users_select" on public.invited_users;
create policy "invited_users_select" on public.invited_users
  for select using (get_my_role() = 'admin');

drop policy if exists "invited_users_update" on public.invited_users;
create policy "invited_users_update" on public.invited_users
  for update
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');


-- ════════════════════════════════════════════════════════════
-- 5. Publish / unpublish programme
-- ════════════════════════════════════════════════════════════
-- Both guards compared a NULL role with <> / NOT IN, which is NULL, not
-- true, so a caller with no role skipped the check. Bodies are otherwise
-- identical to 015 (publish) and 012 (unpublish). The app is the only
-- caller, always as a signed-in user.
create or replace function public.publish_programme(p_project_id uuid)
returns public.programmes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
  v_row  public.programmes;
begin
  if v_role is null or v_role not in ('admin','internal','pricing') then
    raise exception 'Only admin, internal or pricing users may publish a programme';
  end if;

  insert into public.programmes (project_id, status, published_at, published_by_id, created_by_id)
  values (p_project_id, 'published', now(), auth.uid(), auth.uid())
  on conflict (project_id) do update
    set status          = 'published',
        published_at    = now(),
        published_by_id = auth.uid(),
        updated_at      = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.unpublish_programme(p_project_id uuid)
returns public.programmes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := get_my_role();
  v_row  public.programmes;
begin
  if v_role is distinct from 'admin' then
    raise exception 'Only an admin may unpublish a programme';
  end if;

  update public.programmes
     set status          = 'draft',
         published_at    = null,
         published_by_id = null,
         updated_at      = now()
   where project_id = p_project_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No programme exists for this project yet';
  end if;
  return v_row;
end;
$$;

revoke execute on function public.publish_programme(uuid)   from public, anon;
revoke execute on function public.unpublish_programme(uuid) from public, anon;
grant  execute on function public.publish_programme(uuid)   to authenticated, service_role;
grant  execute on function public.unpublish_programme(uuid) to authenticated, service_role;

commit;


-- ============================================================
-- Verification (run after applying)
--
-- A. Storage policies. Expect exactly these on storage.objects for the
--    two buckets, and NO row named "public can read":
--      documents_staff_select / _insert / _update / _delete
--      project_files_select / _insert / _update / _delete
--      project_files_closed_guard   (from 031, unchanged)
--
--   select policyname, cmd, roles from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   order by policyname;
--
-- B. Every table has its active guard. Expect 0 rows:
--
--   select c.relname from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
--     and not exists (select 1 from pg_policies p
--                     where p.schemaname = 'public' and p.tablename = c.relname
--                       and p.policyname = c.relname || '_active_guard');
--
-- C. Publish functions are closed to anonymous callers. Expect f, f:
--
--   select has_function_privilege('anon', 'public.publish_programme(uuid)',   'execute'),
--          has_function_privilege('anon', 'public.unpublish_programme(uuid)', 'execute');
--
-- D. Invitations are admin-only. Expect exactly four rows
--    (invited_users_select / _insert / _update / _delete) plus
--    invited_users_active_guard, and every qual / with_check on the first
--    four to be (get_my_role() = 'admin'::text):
--
--   select policyname, cmd, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'invited_users'
--   order by policyname;
--
-- E. In the app, as an ordinary (non-admin) user and as a subcontractor:
--    open a project document, an RFI attachment and a progress photo;
--    attach a file to an RFI response. As staff: upload a tender document
--    and open it from the emailed link in a private window (no login).
--
-- F. Deactivation, on a throwaway account: Settings → People →
--    Deactivate, then confirm that account can't sign in and that
--      select banned_until from auth.users where email = '<that email>';
--    is set. Reactivate and confirm it clears.
--
-- Undo (storage only, if a file stops opening and you need the old
-- behaviour back while it's looked at):
--
--   drop policy "project_files_select" on storage.objects;
--   create policy "project_files_select" on storage.objects for select
--     using (bucket_id = 'project-files' and auth.uid() is not null);
-- ============================================================
