-- ============================================================
-- ConstructIQ — Supabase Schema (canonical, synced to LIVE DB)
-- Run this entire file in the Supabase SQL Editor to rebuild.
--
-- SYNCED 2026-06-28 against live information_schema / pg_policies
-- (queries A–D). This file now reflects the live database including
-- migrations 001/002/003 and all prior manual hardening. Policies,
-- columns, and CHECK constraints below are LIVE TRUTH — do not trust
-- pre-2026-06-28 git history of this file.
--
-- Key facts captured in this sync:
--   • users.full_name is a GENERATED column (verified live).
--   • The active tender-activity table is tender_activity (SINGULAR);
--     tender_activities (plural) is a legacy orphan — see §11b.
--   • trade_templates is a real table (was previously missing here).
-- ============================================================

-- ── Helper stub (replaced after users table exists) ─────
create or replace function public.get_my_role()
returns text language sql stable security definer
as $$ select 'external'::text $$;

-- ── 1. users ─────────────────────────────────────────────
create table public.users (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text unique not null,
  role              text not null default 'external' check (role in ('admin','internal','pricing','external')),
  first_name        text,
  last_name         text,
  full_name         text generated always as (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) stored,
  phone             text,
  business_name     text,
  construction_role text check (construction_role in ('Architect','Client','External Project Manager','Internal Project Manager','Site Manager','Quantity Surveyor','Subcontractor')),
  notify_rfis       boolean default true,
  notify_documents  boolean default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
alter table public.users enable row level security;

-- Own row; admins/internal read all.
create policy "users_select" on public.users for select using (
  auth.uid() = id
  or get_my_role() in ('admin','internal')
);
-- Self-insert may only create an 'external' row (hardening, migration 002).
create policy "users_insert" on public.users for insert with check (
  auth.uid() = id and role = 'external'
);
-- Admin can update anyone.
create policy "users_update_admin" on public.users for update using (
  get_my_role() = 'admin'
);
-- Self-update may NOT change own role or email (migration 002 — prevents
-- self-escalation and email-impersonation of invitees/assignees).
create policy "users_update_self" on public.users for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role  = (select role  from public.users where id = auth.uid())
    and email = (select email from public.users where id = auth.uid())
  );

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, role)
  values (new.id, new.email, 'external')
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Helper: app role check (after public.users exists) ───
create or replace function public.get_my_role()
returns text language sql stable security definer
as $$ select role from public.users where id = auth.uid() $$;

-- ── 2. projects ──────────────────────────────────────────
create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  start_date    date,
  end_date      date,
  status        text default 'Active' check (status in ('Active','On Hold','Complete','Archived')),
  team          jsonb default '[]',   -- array of team member objects
  doc_folders   jsonb default '[]',   -- persisted document folder names (incl. empty ones)
  created_by_id uuid references public.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table public.projects enable row level security;
-- Scoped (migration 003): non-privileged users see only their own/team projects.
-- Migration 009: 'internal' dropped from see-all — scoped to team membership
-- like external, so internal users only see projects they're invited to.
create policy "projects_select" on public.projects for select using (
  get_my_role() in ('admin','pricing')
  or created_by_id = auth.uid()
  or team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid())))
);
create policy "projects_insert" on public.projects for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
create policy "projects_update" on public.projects for update using (
  get_my_role() = 'admin'
  or created_by_id = auth.uid()
  or (get_my_role() = 'internal' and team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
);
create policy "projects_delete" on public.projects for delete using (
  get_my_role() = 'admin'
);

-- ── 3. tasks ─────────────────────────────────────────────
create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  name             text not null,
  wbs              text,
  level            integer default 2,
  parent_id        uuid references public.tasks(id),
  sort_order       numeric default 0,
  start_date       date,
  end_date         date,
  duration         numeric,
  predecessors     jsonb default '[]',
  is_milestone     boolean default false,
  percent_complete numeric default 0,
  task_status      text check (task_status in ('Not Started','In Progress','On Hold','Complete','Delayed')),
  actual_start     date,
  actual_finish    date,
  delay_days       numeric,
  status_notes     text,
  delay_notes      text,
  assignee_name    text,
  assignee_email   text,
  constraint_data  jsonb,
  created_by_id    uuid references public.users(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  archived         boolean default false
);
alter table public.tasks enable row level security;
-- Migration 009: scoped to team membership for everyone but admin/pricing
-- (internal no longer sees all projects' tasks; external's old assignee_email/
-- created_by_id escape hatches removed — membership is the only path in).
create policy "tasks_select" on public.tasks for select using (
  get_my_role() in ('admin','pricing')
  or exists (
        select 1 from public.projects p
        where p.id = tasks.project_id
        and (p.created_by_id = auth.uid()
             or p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid()))))
     )
);
-- Migration 008: pricing added to all three write policies (UI permission
-- matrix already allowed pricing to edit the programme).
create policy "tasks_insert" on public.tasks for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
-- Migration 009: external's write path (created_by_id/assignee_email) removed —
-- external users are strictly read-only on tasks.
create policy "tasks_update" on public.tasks for update using (
  get_my_role() in ('admin','internal','pricing')
);
create policy "tasks_delete" on public.tasks for delete using (
  get_my_role() in ('admin','internal','pricing')
);

-- ── 4. rfis ──────────────────────────────────────────────
create table public.rfis (
  id                 uuid primary key default gen_random_uuid(),
  number             integer,
  title              text not null,
  description        text,
  project_id         uuid not null references public.projects(id) on delete cascade,
  due_date           date,
  status             text default 'Open' check (status in ('Open','Answered','Closed')),
  priority           text default 'Medium' check (priority in ('Low','Medium','High','Critical')),
  created_by_email   text,
  created_by_name    text,
  assigned_to_email  text,
  assigned_to_name   text,
  assignees          jsonb default '[]',
  assigned_role      text,
  attachments        jsonb default '[]',
  responses          jsonb default '[]',
  created_by_id      uuid references public.users(id),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  archived           boolean default false,
  is_public          boolean default false,
  edited_by_id       uuid,
  edited_at          timestamptz
);
alter table public.rfis enable row level security;
-- Migration 008: privileged see all; external users need team membership PLUS
-- (is_public, or they created / are assigned to the RFI). Fixes the leak where
-- externals saw every RFI on their team projects.
create policy "rfis_select" on public.rfis for select using (
  get_my_role() in ('admin','internal','pricing')
  or (
    (archived = false or archived is null)
    and exists (
      select 1 from public.projects p
      where p.id = rfis.project_id
        and p.team @> jsonb_build_array(jsonb_build_object('user_email',
              (select email from public.users where id = auth.uid())))
    )
    and (
      is_public = true
      or created_by_id = auth.uid()
      or created_by_email  = (select email from public.users where id = auth.uid())
      or assigned_to_email = (select email from public.users where id = auth.uid())
      or assignees @> jsonb_build_array(jsonb_build_object('email',
            (select email from public.users where id = auth.uid())))
    )
  )
);
create policy "rfis_insert" on public.rfis for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
create policy "rfis_update" on public.rfis for update using (
  get_my_role() in ('admin','internal')
  or created_by_id = auth.uid()
  or assigned_to_email = (select email from public.users where id = auth.uid())
  or assignees @> jsonb_build_array(jsonb_build_object('email', (select email from public.users where id = auth.uid())))
);
create policy "rfis_delete" on public.rfis for delete using (
  get_my_role() in ('admin','internal')
);

-- ── 5. documents ─────────────────────────────────────────
create table public.documents (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  project_id          uuid references public.projects(id) on delete cascade,
  folder              text,
  file_url            text not null,
  file_type           text,
  status              text default 'Draft' check (status in ('Draft','In Review','Approved','Superseded')),
  uploaded_by_name    text,
  uploaded_by_email   text not null default '',
  version_number      numeric default 1,
  versions            jsonb default '[]',
  created_by_id       uuid references public.users(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  archived            boolean default false,
  archived_at         timestamptz,
  visibility          text default 'private' check (visibility in ('private','public','assigned')),
  assigned_to_email   text
);
alter table public.documents enable row level security;
create policy "documents_select" on public.documents for select using (
  get_my_role() in ('admin','internal','pricing')
  or created_by_id = auth.uid()
  or uploaded_by_email = (select email from public.users where id = auth.uid())
  or ((visibility is null or visibility = 'public')
      and (archived = false or archived is null)
      and exists (
        select 1 from public.projects p
        where p.id = documents.project_id
        and p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid())))
      ))
  or (visibility = 'assigned' and assigned_to_email = (select email from public.users where id = auth.uid()))
);
create policy "documents_insert" on public.documents for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
create policy "documents_update" on public.documents for update using (
  get_my_role() in ('admin','internal')
  or created_by_id = auth.uid()
);
create policy "documents_delete" on public.documents for delete using (
  get_my_role() in ('admin','internal')
  or created_by_id = auth.uid()
);

-- ── 6. folders ───────────────────────────────────────────
create table public.folders (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  parent_folder_id uuid references public.folders(id),
  full_path        text not null,
  tender_id        uuid,  -- FK added after tenders table
  created_by_id    uuid references public.users(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.folders enable row level security;
create policy "folders_all" on public.folders for all using (
  get_my_role() in ('admin','pricing','internal')
);

-- ── 7. tenders ───────────────────────────────────────────
create table public.tenders (
  id                       uuid primary key default gen_random_uuid(),
  tender_number            text,
  title                    text not null,
  description              text,
  status                   text default 'Draft' check (status in ('Draft','Issued','Submitted','Awarded','Unsuccessful','Archived','On Hold','Cancelled','Converted')),
  issue_date               date,
  closing_date             text,  -- ISO datetime string
  award_date               date,
  estimated_value          numeric,
  project_id               uuid references public.projects(id),
  converted_project_id     uuid references public.projects(id),
  created_by_user_id       uuid references public.users(id),
  created_by_name          text,
  created_by_email         text,
  tender_lead_user_id      uuid references public.users(id),
  tender_lead_name         text,
  tender_lead_email        text,
  tender_lead_phone        text,
  client_name              text,
  client_contact           text,
  client_email             text,
  architect_name           text,
  architect_contact        text,
  architect_email          text,
  project_manager_name     text,
  project_manager_contact  text,
  project_manager_email    text,
  additional_contacts      jsonb default '[]',
  location                 text,
  site_visit_date          date,
  questions_date           date,
  trade_packages           jsonb default '[]',
  documents                jsonb default '[]',
  invitees                 jsonb default '[]',
  scoring_criteria         jsonb default '[]',
  our_result               text,
  our_result_notes         text,
  notes                    text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);
alter table public.tenders enable row level security;
-- Read for privileged roles, owner, lead, or any converted tender.
create policy "tenders_select" on public.tenders for select using (
  (select role from public.users where id = auth.uid()) in ('admin','pricing','internal')
  or created_by_email = (select email from public.users where id = auth.uid())
  or tender_lead_email = (select email from public.users where id = auth.uid())
  or converted_project_id is not null
);
-- insert/update/delete managed via Edge Functions (service role) — no policies.

-- Add FK from folders to tenders now that tenders exists
alter table public.folders add constraint folders_tender_id_fkey
  foreign key (tender_id) references public.tenders(id) on delete cascade;

-- ── 8. tender_invitees ───────────────────────────────────
create table public.tender_invitees (
  id            uuid primary key default gen_random_uuid(),
  tender_id     uuid not null references public.tenders(id) on delete cascade,
  contact_id    uuid,
  full_name     text not null,
  business_name text,
  email         text,
  phone         text,
  trade         text,
  status        text default 'Draft' check (status in ('Draft','Invited','Viewed','Submitted','Declined','Archived')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
-- Unique invite per (tender, email) — migration 001.
create unique index if not exists uq_tender_invitees_tender_email
  on public.tender_invitees(tender_id, lower(email)) where email is not null;
alter table public.tender_invitees enable row level security;
create policy "tender_invitees_select" on public.tender_invitees for select using (
  get_my_role() in ('admin','pricing','internal')
);
create policy "tender_invitees_update" on public.tender_invitees for update using (
  get_my_role() in ('admin','pricing','internal')
);
create policy "tender_invitees_delete" on public.tender_invitees for delete using (
  get_my_role() in ('admin','pricing')
);

-- ── 9. tender_invitations ────────────────────────────────
create table public.tender_invitations (
  id                   uuid primary key default gen_random_uuid(),
  token                uuid not null unique default gen_random_uuid(),
  tender_id            uuid not null references public.tenders(id) on delete cascade,
  invitee_id           uuid references public.tender_invitees(id),
  invitee_email        text,
  invitee_name         text,
  status               text default 'Sent' check (status in ('Sent','Viewed','Submitted')),
  sent_date            text,
  opened_date          text,
  submitted_date       text,
  reminder_24h_sent_at text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);
alter table public.tender_invitations enable row level security;
-- Internal read only — tenderPublicApi uses SERVICE_ROLE_KEY and bypasses RLS.
create policy "tender_invitations_internal_read" on public.tender_invitations
  for select using (get_my_role() in ('admin','pricing','internal'));
-- Writes only via service role (Edge Functions).

-- ── 10. tender_submissions ───────────────────────────────
create table public.tender_submissions (
  id                              uuid primary key default gen_random_uuid(),
  tender_id                       uuid not null references public.tenders(id) on delete cascade,
  invitee_id                      uuid references public.tender_invitees(id),
  invitation_id                   uuid references public.tender_invitations(id),
  invitee_name                    text,
  full_name                       text,
  invitee_email                   text,
  business_name                   text,
  trade                           text,
  lump_sum_price                  numeric,
  notes                           text,
  uploaded_file_url               text,
  uploaded_file_name              text,
  price_breakdown                 jsonb default '[]',
  submitted_at                    text,
  scores                          jsonb default '[]',
  outcome                         text default '' check (outcome in ('','Awarded','Unsuccessful')),
  outcome_notes                   text,
  outcome_notified_at             text,
  outcome_notification_status     text default '' check (outcome_notification_status in ('','Pending','Sent','Failed')),
  outcome_notification_type       text default '' check (outcome_notification_type in ('','Awarded','Unsuccessful')),
  outcome_notification_message_id text,
  outcome_notification_error      text,
  pricing_files                   jsonb default '[]',
  price_lines                     jsonb default '[]',
  created_at                      timestamptz default now(),
  updated_at                      timestamptz default now()
);
alter table public.tender_submissions enable row level security;
create policy "tender_submissions_select" on public.tender_submissions for select using (
  get_my_role() in ('admin','pricing')
);
create policy "tender_submissions_update" on public.tender_submissions for update using (
  get_my_role() in ('admin','pricing')
);
create policy "tender_submissions_delete" on public.tender_submissions for delete using (
  get_my_role() in ('admin','pricing')
);
-- All submission inserts go through tenderPublicApi (service role). No insert policy.

-- ── 11. tender_activity (ACTIVE — singular) ──────────────
-- This is the table the app writes/reads (entities.js, all edge functions).
create table public.tender_activity (
  id          uuid primary key default gen_random_uuid(),
  tender_id   uuid not null references public.tenders(id) on delete cascade,
  event_type  text not null,
  actor_name  text,
  actor_email text,
  description text,
  occurred_at timestamptz default now(),
  created_at  timestamptz default now()
);
alter table public.tender_activity enable row level security;
create policy "ta_all" on public.tender_activity for all using (
  (select role from public.users where id = auth.uid()) in ('admin','pricing','internal')
);
create policy "tender_activity_insert" on public.tender_activity for insert with check (
  (select role from public.users where id = auth.uid()) in ('admin','pricing','internal')
);
create policy "tender_activity_select" on public.tender_activity for select using (
  (select role from public.users where id = auth.uid()) in ('admin','pricing','internal')
);

-- (The legacy plural tender_activities table was dropped in migration 004 —
--  it was a dead orphan with no code path. Do not recreate it.)

-- ── 12. tender_contacts ──────────────────────────────────
create table public.tender_contacts (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  business_name text,
  email         text,
  phone         text,
  trade         text,
  notes         text,
  created_by_id uuid references public.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table public.tender_contacts enable row level security;
create policy "tender_contacts_select" on public.tender_contacts for select using (
  get_my_role() in ('admin','pricing','internal')
);
create policy "tender_contacts_update" on public.tender_contacts for update using (
  get_my_role() in ('admin','pricing','internal')
);
create policy "tender_contacts_delete" on public.tender_contacts for delete using (
  get_my_role() = 'admin'
);

-- ── 13. tender_counter ───────────────────────────────────
create table public.tender_counter (
  id            uuid primary key default gen_random_uuid(),
  current_value integer default 0,
  lock_id       text,
  locked_at     text,
  created_at    timestamptz default now()
);
alter table public.tender_counter enable row level security;
-- Managed entirely via service role in Edge Functions.

-- ── 14. tender_settings ──────────────────────────────────
create table public.tender_settings (
  id                            uuid primary key default gen_random_uuid(),
  default_contact_roles         jsonb default '[]',
  notify_lead_on_submission     boolean default true,
  notify_admins_on_submission   boolean default false,
  send_24h_reminder             boolean default true,
  send_immediate_notifications  boolean default true,
  send_daily_summary            boolean default false,
  created_at                    timestamptz default now(),
  updated_at                    timestamptz default now()
);
alter table public.tender_settings enable row level security;
create policy "tender_settings_all" on public.tender_settings for all using (
  get_my_role() = 'admin'
);

-- ── 15. invited_users ────────────────────────────────────
create table public.invited_users (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  app_role         text,
  project_role     text,
  invited_by_email text,
  project_id       uuid,
  project_name     text,
  status           text default 'Pending' check (status in ('Pending','Accepted','Expired','Cancelled')),
  token            uuid unique,
  token_created_at text,
  token_expires_at text,
  last_invited_at  text,
  resend_count     integer default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.invited_users enable row level security;
create policy "invited_users_select" on public.invited_users for select using (
  get_my_role() in ('admin','internal','pricing')
);
create policy "invited_users_insert" on public.invited_users for insert with check (
  get_my_role() = 'admin'
);
create policy "invited_users_update" on public.invited_users for update using (
  get_my_role() in ('admin','internal','pricing')
);
create policy "invited_users_delete" on public.invited_users for delete using (
  get_my_role() = 'admin'
);

-- ── 16. pending_project_assignments ──────────────────────
create table public.pending_project_assignments (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  project_id      uuid references public.projects(id),
  role            text,
  project_role    text,
  permission_role text,
  invited_by      text,
  invitation_id   uuid references public.invited_users(id),
  status          text default 'Pending' check (status in ('Pending','Activated','Cancelled')),
  full_name       text,
  business_name   text,
  phone           text,
  trade           text,
  created_date    text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.pending_project_assignments enable row level security;
create policy "pending_assignments_all" on public.pending_project_assignments for all using (
  get_my_role() in ('admin','internal','pricing')
);

-- ── 17. project_roles ────────────────────────────────────
create table public.project_roles (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  permission_role text not null check (permission_role in ('admin','internal','external','pricing')),
  description     text,
  active          boolean default true,
  sort_order      integer default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.project_roles enable row level security;
create policy "project_roles_select" on public.project_roles for select using (
  get_my_role() in ('admin','internal','pricing')
);
create policy "project_roles_insert" on public.project_roles for insert with check (
  get_my_role() = 'admin'
);
create policy "project_roles_update" on public.project_roles for update using (
  get_my_role() = 'admin'
);
create policy "project_roles_delete" on public.project_roles for delete using (
  get_my_role() = 'admin'
);

-- ── 18. audit_logs ───────────────────────────────────────
create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  action        text not null,
  entity_type   text,
  entity_id     text,
  project_id    uuid,
  invitation_id uuid,
  user_id       uuid,
  user_name     text,
  description   text,
  created_date  text,
  created_at    timestamptz default now()
);
alter table public.audit_logs enable row level security;
create policy "audit_logs_select" on public.audit_logs for select using (
  get_my_role() in ('admin','internal')
);
create policy "audit_logs_insert" on public.audit_logs for insert with check (
  get_my_role() in ('admin','internal','pricing')
);
create policy "audit_logs_delete" on public.audit_logs for delete using (
  get_my_role() = 'admin'
);

-- ── 19. email_branding ───────────────────────────────────
create table public.email_branding (
  id              uuid primary key default gen_random_uuid(),
  logo_url        text,
  logo_width      integer,
  logo_alignment  text,
  brand_colour    text,
  footer_text     text,
  company_name    text,
  sender_name     text,
  sender_email    text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.email_branding enable row level security;
create policy "email_branding_select" on public.email_branding for select using (auth.uid() is not null);
create policy "email_branding_write" on public.email_branding for all using (
  get_my_role() = 'admin'
);

-- ── 20. email_templates ──────────────────────────────────
create table public.email_templates (
  id           uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  name         text not null,
  subject      text,
  body_html    text,
  body_text    text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table public.email_templates enable row level security;
create policy "email_templates_select" on public.email_templates for select using (auth.uid() is not null);
create policy "email_templates_write" on public.email_templates for all using (
  get_my_role() = 'admin'
);

-- ── 21. document_folder_templates ────────────────────────
create table public.document_folder_templates (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  is_default         boolean default false,
  folder_structure   jsonb default '[]',
  folder_permissions jsonb default '{}',
  created_by_id      uuid references public.users(id),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
alter table public.document_folder_templates enable row level security;
create policy "doc_folder_templates_all" on public.document_folder_templates for all using (
  get_my_role() = 'admin'
);
create policy "doc_folder_templates_select" on public.document_folder_templates for select using (
  get_my_role() in ('admin','pricing','internal','external')
);

-- ── 22. tender_notices ───────────────────────────────────
create table public.tender_notices (
  id                      uuid primary key default gen_random_uuid(),
  tender_id               uuid not null references public.tenders(id) on delete cascade,
  notice_number           text not null,
  title                   text not null,
  description             text,
  notice_type             text not null check (notice_type in ('Clarification','Additional Information','Revised Documents','Scope Change','Closing Date Extension')),
  status                  text not null default 'Draft' check (status in ('Draft','Issued','Archived')),
  issue_date              timestamptz,
  issued_by               text,
  changes_close_date      boolean default false,
  old_close_date          text,
  proposed_new_close_date text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);
alter table public.tender_notices enable row level security;
create policy "tn_internal" on public.tender_notices for all using (
  (select role from public.users where id = auth.uid()) in ('admin','pricing')
);
-- Auth required (migration M1) — was previously anon-readable.
create policy "tender_notices_public_read" on public.tender_notices
  for select using (status = 'Issued' and auth.uid() is not null);

-- ── 23. tender_notice_attachments ────────────────────────
create table public.tender_notice_attachments (
  id                       uuid primary key default gen_random_uuid(),
  notice_id                uuid not null references public.tender_notices(id) on delete cascade,
  document_id              uuid,
  file_url                 text,
  file_name                text,
  superseded_document_id   uuid,
  replacement_document_id  uuid,
  created_at               timestamptz default now()
);
alter table public.tender_notice_attachments enable row level security;
-- Split into read/write (migration M2) — writes admin/pricing only.
create policy "tender_notice_attachments_select" on public.tender_notice_attachments for select using (
  get_my_role() in ('admin','pricing')
  or (auth.uid() is not null and exists (
        select 1 from public.tender_notices tn
        where tn.id = notice_id and tn.status = 'Issued'
     ))
);
create policy "tender_notice_attachments_write" on public.tender_notice_attachments for all using (
  get_my_role() in ('admin','pricing')
);

-- ── 24. contract_instructions ────────────────────────────
create table public.contract_instructions (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  ci_number        text not null,
  title            text not null,
  description      text,
  instruction_type text not null check (instruction_type in ('Variation Approval','Scope Change','Direction','Information','Instruction')),
  status           text not null default 'Draft' check (status in ('Draft','Issued','Archived')),
  issue_date       timestamptz,
  issued_by        text,
  attachments      jsonb default '[]',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  archived         boolean default false
);
alter table public.contract_instructions enable row level security;
create policy "ci_manage" on public.contract_instructions for all using (
  (select role from public.users where id = auth.uid()) in ('admin','pricing','internal')
);
create policy "ci_read" on public.contract_instructions for select using (
  (select role from public.users where id = auth.uid()) in ('admin','pricing','internal')
  or exists (
    select 1 from public.projects p
    where p.id = project_id
    and p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid())))
  )
);
create policy "ci_external_read" on public.contract_instructions for select using (
  get_my_role() = 'external'
  and archived = false
  and exists (
    select 1 from public.projects p
    where p.id = project_id
    and p.team @> jsonb_build_array(jsonb_build_object('user_email', (select email from public.users where id = auth.uid())))
  )
);

-- ── 25. trade_templates ──────────────────────────────────
-- Subcontractor trade categories (Settings → Trade Templates).
create table public.trade_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text,
  sort_order integer default 0,
  created_at timestamptz default now()
);
alter table public.trade_templates enable row level security;
create policy "trade_templates_read" on public.trade_templates for select using (auth.uid() is not null);
create policy "trade_templates_write" on public.trade_templates for all using (
  (select role from public.users where id = auth.uid()) = 'admin'
);

-- ── 26. reminder_settings ────────────────────────────────
create table if not exists public.reminder_settings (
  id            uuid primary key default gen_random_uuid(),
  reminder_type text not null unique check (reminder_type in ('tender_external','tender_internal','rfi_reminder')),
  enabled       boolean default true,
  days_before   int default 2,
  send_time     text default '08:00',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table public.reminder_settings enable row level security;
create policy "reminder_settings_read" on public.reminder_settings for select using (auth.uid() is not null);
create policy "reminder_settings_write" on public.reminder_settings for all using (get_my_role() = 'admin');
grant select, insert, update, delete on public.reminder_settings to authenticated;

-- ── 27. reminder_log (dedup — prevents double-sending) ────
create table if not exists public.reminder_log (
  id              uuid primary key default gen_random_uuid(),
  reminder_type   text not null,
  entity_id       uuid not null,
  recipient_email text not null,
  sent_at         timestamptz default now(),
  unique (reminder_type, entity_id, recipient_email)
);
alter table public.reminder_log enable row level security;
create policy "reminder_log_admin" on public.reminder_log for all using (get_my_role() = 'admin');
grant select, insert on public.reminder_log to authenticated;

-- ── 28. tender_rfis (portal questions) ───────────────────
create table if not exists public.tender_rfis (
  id               uuid primary key default gen_random_uuid(),
  tender_id        uuid not null references public.tenders(id) on delete cascade,
  invitation_id    uuid not null references public.tender_invitations(id) on delete cascade,
  created_by_email text not null,
  created_by_name  text,
  subject          text not null,
  description      text,
  status           text not null default 'Open' check (status in ('Open','Answered','Closed')),
  edited_by_email  text,
  edited_at        timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.tender_rfis enable row level security;
create policy "tender_rfis_admin" on public.tender_rfis for all
  using (get_my_role() in ('admin','pricing','internal'));
-- Portal inserts go through tenderPublicApi (service role) — no insert policy.
create policy "tender_rfis_invitee_select" on public.tender_rfis for select using (
  created_by_email = (select email from public.users where id = auth.uid())
  or exists (
    select 1 from public.tender_invitations ti
    where ti.id = invitation_id and ti.invitee_email = (select email from public.users where id = auth.uid())
  )
);

-- ── 29. tender_rfi_responses ─────────────────────────────
create table if not exists public.tender_rfi_responses (
  id              uuid primary key default gen_random_uuid(),
  rfi_id          uuid not null references public.tender_rfis(id) on delete cascade,
  author_email    text not null,
  author_name     text,
  content         text not null,
  edited_by_email text,
  edited_at       timestamptz,
  created_at      timestamptz default now()
);
alter table public.tender_rfi_responses enable row level security;
create policy "tender_rfi_responses_admin" on public.tender_rfi_responses for all
  using (get_my_role() in ('admin','pricing','internal'));
-- Portal inserts go through tenderPublicApi (service role) — no insert policy.
create policy "tender_rfi_responses_select" on public.tender_rfi_responses for select using (
  exists (
    select 1 from public.tender_rfis tr
    where tr.id = rfi_id
    and (
      tr.created_by_email = (select email from public.users where id = auth.uid())
      or exists (
        select 1 from public.tender_invitations ti
        where ti.id = tr.invitation_id and ti.invitee_email = (select email from public.users where id = auth.uid())
      )
    )
  )
);

-- ── Indexes (migration 001) ──────────────────────────────
create index if not exists idx_tender_invitees_tender_id      on public.tender_invitees(tender_id);
create index if not exists idx_tender_invitations_tender_id   on public.tender_invitations(tender_id);
create index if not exists idx_tender_invitations_invitee_id  on public.tender_invitations(invitee_id);
create index if not exists idx_tender_submissions_tender_id   on public.tender_submissions(tender_id);
create index if not exists idx_documents_project_id           on public.documents(project_id);
create index if not exists idx_documents_project_archived      on public.documents(project_id, archived) where archived = false;
create index if not exists idx_rfis_project_id                on public.rfis(project_id);
create index if not exists idx_tasks_project_id               on public.tasks(project_id);
create index if not exists idx_pending_assignments_email      on public.pending_project_assignments(email, status);
create index if not exists idx_invited_users_email            on public.invited_users(email);

-- ── Project-archive cascade: mark child records archived, and restore them when
-- the project is un-archived (status moves away from 'Archived') ──
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
drop trigger if exists archive_project_children_trigger on public.projects;
create trigger archive_project_children_trigger
  after update of status on public.projects
  for each row execute function public.archive_project_children();

-- ── 30. project_activity (migration 008) ─────────────────
-- Shared activity feed for projects / documents / RFIs.
-- entity_id has no FK on purpose: activity outlives the entity.
create table if not exists public.project_activity (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  entity_type text not null check (entity_type in ('project','document','rfi')),
  entity_id   uuid,
  event_type  text not null,
  actor_name  text,
  actor_email text,
  description text,
  metadata    jsonb default '{}'::jsonb,
  occurred_at timestamptz default now(),
  created_at  timestamptz default now()
);
create index if not exists idx_project_activity_project
  on public.project_activity (project_id, occurred_at desc);
create index if not exists idx_project_activity_entity
  on public.project_activity (entity_type, entity_id);
alter table public.project_activity enable row level security;
-- Internal-only, mirroring tender_activity.
create policy "project_activity_select" on public.project_activity for select using (
  get_my_role() in ('admin','pricing','internal')
);
create policy "project_activity_insert" on public.project_activity for insert with check (
  get_my_role() in ('admin','pricing','internal')
);
create policy "project_activity_delete" on public.project_activity for delete using (
  get_my_role() = 'admin'
);
grant select, insert, delete on public.project_activity to authenticated;

-- ── Seeds ────────────────────────────────────────────────
insert into public.tender_counter (current_value) values (0);
insert into public.tender_settings (
  notify_lead_on_submission, notify_admins_on_submission,
  send_24h_reminder, send_immediate_notifications, send_daily_summary
) values (true, false, true, true, false);
insert into public.reminder_settings (reminder_type, enabled, days_before) values
  ('tender_external', true, 2),
  ('tender_internal', true, 1),
  ('rfi_reminder',    true, 1)
on conflict (reminder_type) do nothing;
