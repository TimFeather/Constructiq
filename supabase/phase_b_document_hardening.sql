-- ============================================================================
-- Phase B — Document system schema & RLS hardening
-- Run in the Supabase SQL Editor. Each block is guarded/idempotent and safe to
-- re-run. Run the blocks IN ORDER — backfills precede the constraints they enable.
-- ============================================================================

-- ── M1: composite index for the hot "active documents" query ────────────────
-- WHERE archived = false scans are currently un-indexed beyond project_id.
create index if not exists idx_documents_project_archived
  on public.documents(project_id, archived) where archived = false;

-- ── M2: drop dead column is_public ──────────────────────────────────────────
-- Never written by any frontend/edge function and not referenced by RLS.
alter table public.documents drop column if exists is_public;

-- ── M6: archived_at — record WHEN a document was archived ────────────────────
alter table public.documents add column if not exists archived_at timestamptz;
-- Backfill existing archived rows (best-effort timestamp from updated_at).
update public.documents
  set archived_at = coalesce(updated_at, now())
  where archived = true and archived_at is null;

-- Recreate the cascade trigger fn so future archives also stamp archived_at.
create or replace function public.archive_project_children()
returns trigger as $$
begin
  if new.status = 'Archived' and old.status != 'Archived' then
    update documents              set archived = true, archived_at = now() where project_id = new.id;
    update rfis                   set archived = true where project_id = new.id;
    update tasks                  set archived = true where project_id = new.id;
    update contract_instructions  set archived = true where project_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;

-- ── M5a: uploaded_by_email NOT NULL (safe via default '') ───────────────────
-- ConvertToProjectModal inserts documents without this field, so a default keeps
-- every inserter working; backfill legacy nulls before enforcing.
update public.documents set uploaded_by_email = '' where uploaded_by_email is null;
alter table public.documents alter column uploaded_by_email set default '';
alter table public.documents alter column uploaded_by_email set not null;

-- ── M5b: file_url NOT NULL ──────────────────────────────────────────────────
-- PRE-CHECK FIRST — this must return 0. A null file_url is a document row with no
-- file (already broken); if any exist, investigate them before running the ALTER
-- rather than masking them.
--   select count(*) from public.documents where file_url is null;
-- When the count is 0, run:
alter table public.documents alter column file_url set not null;

-- ============================================================================
-- OPTIONAL / deferred (NOT applied — review before considering):
--   M3  Simplify documents_select RLS / drop assigned_to_email branch.
--       The current policy (private/public/assigned) is coherent; assigned has no
--       UI but is harmless. Changing it is security-relevant — leave as-is for now.
--   H4  CHECK constraint validating versions[] element shape. Could fail on legacy
--       malformed rows; low value now that the app writes a consistent shape.
-- ============================================================================
