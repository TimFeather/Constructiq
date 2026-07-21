-- ════════════════════════════════════════════════════════════════════
-- Migration 023 — service_role grants for tables used by edge functions
--
-- Found by auditing every table in public for missing privileges after
-- migrations 006 and 020 both shipped without grants (fixed by 007/021).
--
-- These three were granted to `authenticated` but never to `service_role`,
-- despite being read/written by edge functions, which connect as
-- service_role. BYPASSRLS skips row policies, not table grants, so every
-- one of those queries fails with 42501.
--
--   reminder_settings  — sendReminders reads to decide what to send
--   reminder_log       — sendReminders writes to dedupe
--   project_activity   — notifyProgrammePublished writes an activity line
--
-- sendReminders discards the query error (destructures `data` only), so a
-- failed settings read left `settings = []`, every reminder block was
-- skipped, and the function reported success having sent nothing. The
-- reminders were not failing loudly — they were not running at all.
--
-- Deliberately NOT granted here:
--   takeoff_*          — orphaned by the TakeoffIQ pivot, nothing reads them
--   trade_templates    — client-only, no edge function touches it
--   tender_invitee_delivery — UI view, read by authenticated only
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

grant select, insert, update, delete on
  public.reminder_settings,
  public.reminder_log,
  public.project_activity
to service_role;

-- ============================================================
-- Verification (run after applying):
--
-- select c.relname,
--        has_table_privilege('service_role', c.oid, 'SELECT') as sr_read
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relname in ('reminder_settings','reminder_log','project_activity');
-- -- expect sr_read = true for all three
--
-- Then confirm reminders actually run:
--   supabase functions invoke sendReminders
-- -- response should report the tenders it considered, not 0 across the board
-- ============================================================
