-- ════════════════════════════════════════════════════════════════════
-- Migration 024 — attribute unlinked delivery problems by email address
--
-- Only five of the eleven functions that send mail log tender/invitee
-- context. The rest (tenderPublicApi, invitationService, issueNTT,
-- registerInvited, notifyProgrammePublished, sendEmail) produce
-- email_messages rows created by the webhook alone, with no invitee_id —
-- so their bounces and delays never reached the invitee badge. Same for
-- anything sent before send-side logging existed.
--
-- Observed: two 'delayed' rows for ATKcontracting@outlook.co.nz, both
-- kind=null / invitee_id=null, visible in Settings but not on the invitee.
--
-- The view now also matches unlinked messages to invitees on the recipient
-- address.
--
-- IMPORTANT: this fallback is limited to PROBLEM statuses
-- (bounced/failed/complained/delayed). Unlinked rows carry no tender_id,
-- so an address appearing in several tenders matches all of them —
-- acceptable for "this address is having trouble", which is a property of
-- the address, but NOT for success. Inferring 'delivered' by address would
-- claim an invitation arrived for a tender it was never sent for. Good
-- statuses therefore still require an explicit invitee_id link.
--
-- Driven from tender_invitees so tender_id is always correct, including
-- for invitees whose only record is an address-matched orphan.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

drop view if exists public.tender_invitee_delivery;

create view public.tender_invitee_delivery as
with linked as (
  select * from public.email_messages where invitee_id is not null
),
latest as (
  -- Per-tender truth: only messages we know belong to this invitee.
  select distinct on (invitee_id)
    invitee_id, id as message_id, status, error_type, error_subtype,
    error_message, last_event_at, created_at
  from linked
  order by invitee_id, created_at desc
),
problems as (
  select invitee_id, status, error_type, error_subtype, error_message, created_at
    from linked
   where status in ('bounced', 'failed', 'complained', 'delayed')
  union all
  select i.id, m.status, m.error_type, m.error_subtype, m.error_message, m.created_at
    from public.email_messages m
    join public.tender_invitees i
      on i.email is not null
     and lower(i.email) = lower(m.recipient)
   where m.invitee_id is null
     and m.status in ('bounced', 'failed', 'complained', 'delayed')
),
last_problem as (
  select distinct on (invitee_id)
    invitee_id, status, error_type, error_subtype, error_message, created_at
  from problems
  order by invitee_id, created_at desc
)
select
  i.id                                        as invitee_id,
  i.tender_id,
  l.message_id,
  l.status,
  l.last_event_at,
  coalesce(l.created_at, p.created_at)        as created_at,
  p.status                                    as failure_status,
  p.created_at                                as failed_at,
  coalesce(p.error_type,    l.error_type)     as error_type,
  coalesce(p.error_subtype, l.error_subtype)  as error_subtype,
  coalesce(p.error_message, l.error_message)  as error_message
from public.tender_invitees i
left join latest       l on l.invitee_id = i.id
left join last_problem p on p.invitee_id = i.id
where l.invitee_id is not null
   or p.invitee_id is not null;

alter view public.tender_invitee_delivery set (security_invoker = on);

-- DROP discards grants (see 021).
grant select on public.tender_invitee_delivery to authenticated;

-- ============================================================
-- Verification (run after applying):
--
-- select invitee_id, tender_id, status, failure_status, error_message
--   from public.tender_invitee_delivery
--  where failure_status is not null;
-- -- the ATKcontracting@outlook.co.nz invitee should now appear with
-- -- failure_status='delayed' and a non-null tender_id, even though its
-- -- email_messages rows have invitee_id = null
-- ============================================================
