-- ════════════════════════════════════════════════════════════════════
-- Migration 022 — tender_invitee_delivery: stop resends masking bounces
--
-- The 020 view took the most recent message per invitee. Resending to an
-- invitee therefore replaced a known 'bounced' with a fresh 'sent', so the
-- badge went green-ish again while the address was still undeliverable —
-- hiding the exact problem the feature exists to surface.
--
-- Observed: invitation bounced 03:47, operator hit Resend 03:52, badge
-- flipped back to 'Sent' even though nothing had changed about the address.
--
-- Now the view reports both:
--   status          — the latest message's status (is a resend in flight?)
--   failure_status  — the most recent failure, if any
--
-- The UI shows the failure until a later message actually lands
-- (delivered/opened/clicked), because resending to a bad address fails the
-- same way and the operator needs to fix the address, not retry.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

drop view if exists public.tender_invitee_delivery;

create view public.tender_invitee_delivery as
with latest as (
  select distinct on (invitee_id)
    invitee_id, tender_id, id, status, error_type, error_subtype,
    error_message, last_event_at, created_at
  from public.email_messages
  where invitee_id is not null
  order by invitee_id, created_at desc
),
last_failure as (
  select distinct on (invitee_id)
    invitee_id, status, error_type, error_subtype, error_message,
    created_at
  from public.email_messages
  where invitee_id is not null
    and status in ('bounced', 'failed', 'complained')
  order by invitee_id, created_at desc
)
select
  l.invitee_id,
  l.tender_id,
  l.id                                              as message_id,
  l.status,
  l.last_event_at,
  l.created_at,
  f.status                                          as failure_status,
  f.created_at                                      as failed_at,
  -- Prefer the failure's detail; it is what the operator needs to act on.
  coalesce(f.error_type,    l.error_type)           as error_type,
  coalesce(f.error_subtype, l.error_subtype)        as error_subtype,
  coalesce(f.error_message, l.error_message)        as error_message
from latest l
left join last_failure f using (invitee_id);

alter view public.tender_invitee_delivery set (security_invoker = on);

-- DROP discards grants, so re-apply (see 021).
grant select on public.tender_invitee_delivery to authenticated;

-- ============================================================
-- Verification (run after applying):
--
-- select invitee_id, status, failure_status, failed_at
--   from public.tender_invitee_delivery
--  where failure_status is not null;
-- -- an invitee that bounced then got resent should show
-- -- status='sent' alongside failure_status='bounced'
-- ============================================================
