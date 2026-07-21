-- ============================================================
-- Migration 020 — Email delivery log (Resend webhook)
-- Run in Supabase SQL Editor.
--
-- Until now every email was fire-and-forget: sendTenderInvitations
-- flipped tender_invitees.status to 'Invited' whether or not Resend
-- ever delivered it, and the Resend message id was discarded. A hard
-- bounce (typo'd domain, dead domain) looked identical in the UI to a
-- delivered invitation.
--
-- Two tables:
--   email_messages — one row per email, current delivery status
--   email_events   — raw Resend webhook events, append-only audit trail
--
-- email_messages rows are created by the send path when context is
-- known (tender/invitee), and upserted by the webhook otherwise, so
-- every email Resend touches lands in the log either way.
--
-- NOTE: this file does not grant base table privileges to the Supabase
-- API roles. Run 021_email_delivery_grants.sql straight after it, or
-- every read fails with 42501 before RLS is even evaluated.
-- ============================================================

-- ── email_messages ───────────────────────────────────────
create table if not exists public.email_messages (
  id            uuid primary key default gen_random_uuid(),
  resend_id     text unique,                 -- Resend message id; null only if the send call itself failed
  recipient     text not null,
  subject       text,
  kind          text,                        -- 'tender_invitation', 'reminder', 'outcome', ... (free-form)
  status        text not null default 'queued'
                  check (status in ('queued','scheduled','sent','delayed','delivered',
                                    'opened','clicked','bounced','complained','failed')),
  status_rank   int  not null default 0,     -- guards against out-of-order webhook delivery
  -- Context — nullable, populated when the send path knows it
  tender_id     uuid references public.tenders(id) on delete set null,
  invitee_id    uuid references public.tender_invitees(id) on delete set null,
  project_id    uuid references public.projects(id) on delete set null,
  sent_by       uuid references public.users(id) on delete set null,
  -- Failure detail, from the bounce/failed event
  error_type    text,                        -- Resend bounce type: Transient / Permanent / Undetermined
  error_subtype text,                        -- General / NoEmail / Suppressed / MailboxFull ...
  error_message text,                        -- raw SMTP response
  last_event_at timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_email_messages_recipient  on public.email_messages(lower(recipient));
create index if not exists idx_email_messages_tender_id  on public.email_messages(tender_id);
create index if not exists idx_email_messages_invitee_id on public.email_messages(invitee_id);
create index if not exists idx_email_messages_status     on public.email_messages(status);
create index if not exists idx_email_messages_created_at on public.email_messages(created_at desc);

alter table public.email_messages enable row level security;

-- Read-only for staff. All writes go through Edge Functions on the
-- service role key, which bypasses RLS.
create policy "email_messages_select" on public.email_messages for select using (
  get_my_role() in ('admin','pricing','internal')
);

-- ── email_events ─────────────────────────────────────────
create table if not exists public.email_events (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid references public.email_messages(id) on delete cascade,
  resend_id   text,
  svix_id     text unique,                   -- webhook delivery id — makes replays idempotent
  event_type  text not null,                 -- 'email.delivered', 'email.bounced', ...
  occurred_at timestamptz,
  payload     jsonb default '{}',
  created_at  timestamptz default now()
);

create index if not exists idx_email_events_message_id on public.email_events(message_id);
create index if not exists idx_email_events_resend_id  on public.email_events(resend_id);

alter table public.email_events enable row level security;

create policy "email_events_select" on public.email_events for select using (
  get_my_role() in ('admin','pricing','internal')
);

-- ── Latest delivery status per tender invitee ────────────
-- Used by InviteeManager to badge invitees whose invitation bounced.
-- An invitee can have several emails (invitation, resend, reminders);
-- we surface the most recent one.
create or replace view public.tender_invitee_delivery as
select distinct on (m.invitee_id)
  m.invitee_id,
  m.tender_id,
  m.id            as message_id,
  m.status,
  m.error_type,
  m.error_subtype,
  m.error_message,
  m.last_event_at,
  m.created_at
from public.email_messages m
where m.invitee_id is not null
order by m.invitee_id, m.created_at desc;

grant select on public.tender_invitee_delivery to authenticated;

-- Views run as their owner, so scope the underlying read here.
alter view public.tender_invitee_delivery set (security_invoker = on);

-- ============================================================
-- Verification (run after applying):
--
-- select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('email_messages','email_events');
-- -- expect 2 rows
--
-- select policyname from pg_policies
--   where tablename in ('email_messages','email_events');
-- -- expect email_messages_select, email_events_select
--
-- select * from public.tender_invitee_delivery limit 1;
-- -- expect 0 rows, no error
-- ============================================================
