-- ============================================================
-- Migration 002 — User Data Security Fixes (audit 2026-06-28)
-- Run in Supabase SQL Editor. Items #2–#7 from the RLS audit.
-- Each is low-risk: it removes over-permissive access without
-- touching any path the app actually uses (portal writes/reads
-- go through service-role edge functions, not these policies).
-- NOTE: Audit item #1 (projects_select open to all authenticated)
-- is intentionally NOT here — it needs an external-user test first.
-- ============================================================

-- ── #2: Pin email (not just role) on self-update of users ───────
-- Prevents a user rewriting their own public.users.email to an
-- invitee/assignee address to inherit that email's RLS access.
-- The WITH CHECK ALLOWS the registration upsert (role/email unchanged
-- from the values the handle_new_user trigger already set) while
-- BLOCKING any actual change. Admin role changes use users_update_admin.
--
-- NOTE: do NOT `revoke update(role/email/id) ... from authenticated` —
-- that role is shared by admins, and would break both the registration
-- upsert (ON CONFLICT DO UPDATE writes role/email) and admin role
-- management in UserManagement. The WITH CHECK below is sufficient.
drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role  = (select role  from public.users where id = auth.uid())
    and email = (select email from public.users where id = auth.uid())
  );

-- Hardening: a self-inserted users row may only be 'external'. Closes the
-- (trigger-dependent) gap where a user could INSERT their own row with
-- role='admin' if the handle_new_user trigger hadn't pre-created it.
-- Safe: the only client-side users insert is Register (role='external');
-- admin user creation + role grants run via edge functions (service role,
-- which bypasses RLS). Column default is 'external', so role-omitted inserts
-- still pass.
drop policy if exists "users_insert" on public.users;
create policy "users_insert" on public.users for insert
  with check (auth.uid() = id and role = 'external');

-- ── #3: Remove over-permissive write on tender_notice_attachments ─
-- tna_internal is FOR ALL to authenticated with an "issued notice"
-- branch, letting any logged-in user insert/delete attachments on
-- issued notices. The _write (admin/pricing) and _select policies
-- already cover the correct matrix.
drop policy if exists "tna_internal" on public.tender_notice_attachments;

-- ── #4: Remove public read of all tender portal questions ────────
-- tender_rfis_portal_select USING (true) exposes every question across
-- all tenders to anyone. Invitee/admin policies already cover real use;
-- the public portal reads via the tenderPublicApi service-role function.
drop policy if exists "tender_rfis_portal_select" on public.tender_rfis;

-- ── #5: Remove leftover anon read of issued tender notices ───────
-- tender_notices_public_read (auth + issued) is the intended policy;
-- tn_public_read (anon, issued) was never dropped after M1.
drop policy if exists "tn_public_read" on public.tender_notices;

-- ── #6: Require auth to read email templates ─────────────────────
drop policy if exists "email_templates_select" on public.email_templates;
create policy "email_templates_select" on public.email_templates
  for select using (auth.uid() is not null);

-- ── #7: Cleanup — duplicate policies + inert anon write grants ───
-- Standardise on get_my_role() versions; drop the subquery duplicates.
drop policy if exists "tender_rfis_internal"          on public.tender_rfis;
drop policy if exists "tender_rfi_responses_internal" on public.tender_rfi_responses;

-- Anon has no INSERT policy on these (RLS already denies), but revoke
-- the unused write grants so the surface matches intent.
revoke insert, update, delete on public.tender_rfis          from anon;
revoke insert, update, delete on public.tender_rfi_responses from anon;
