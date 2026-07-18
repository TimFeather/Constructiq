-- Adjustable critical-slack threshold per programme (MS Project's "tasks are
-- critical if slack is ≤ N days"). 0 = only true zero-float tasks are critical;
-- higher values ALSO flag near-critical tasks (widens the net, never narrows).
--
-- NOTE: this column was already added to the live DB on 2026-07-18 (the file
-- was briefly deleted during a revert); `if not exists` makes re-running safe.
alter table public.programmes
  add column if not exists critical_slack_tolerance_days integer not null default 0;
