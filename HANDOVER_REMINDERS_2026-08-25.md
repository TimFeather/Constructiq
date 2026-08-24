# Handover — Tender reminder fixes (2026-08-25)

All six phases of `PLAN_REMINDERS_2026-08-25.md` are implemented and committed to `main`
locally (not pushed). This doc is the checklist of what's left for you to actually run —
nothing here has been applied automatically; per the plan's working rules, migrations and
deploys are always yours.

## 1. Run migration 029

New table `reminder_runs` — one row per `sendReminders` invocation (sent or not), so a dead
cron and a quiet week stop looking identical from the outside.

Paste [`supabase/migrations/029_reminder_runs.sql`](supabase/migrations/029_reminder_runs.sql)
into the Supabase SQL editor. It includes its own verification query as a trailing comment —
run that after, and confirm all three `has_table_privilege` columns come back `true`. If any
come back `false`, the grants didn't take — don't move on to step 3 until they do; a missing
grant here would be the fourth time this exact mistake breaks reminders (006/007, 020/021,
023 were the first three, per `supabase/migrations/README.md`).

## 2. Deploy the function

```bash
cd C:\Users\TimTotalHomeSolution\Claude\Projects\ConstructIQ-migration
supabase functions deploy sendReminders
```

**Do this even if you deployed partway through the phases.** You confirmed a deploy after
Phase 2, but Phases 3, 4, 5, and 6 all touched `sendReminders/index.ts` after that, and none
of those deploys were confirmed back to me — so production is very likely still running
Phase-2-only code (fixed timezone math, but still the old dedup key, the old silent query
failures, and no `reminder_runs` write). One deploy now picks up everything through Phase 6.

## 3. Schedule the cron

**First, know what's currently in `cron.job`.** You ran the Phase 0 diagnostic SQL earlier
but I never saw the output — I don't know whether a `send-reminders-daily` job already
exists (pointed at the right function or a stale one), or whether nothing is scheduled at
all. Run this first:

```sql
select jobid, jobname, schedule, active, command from cron.job;
```

- **No rows** → proceed straight to the `cron.schedule` block below.
- **A row for `send-reminders-daily`** → it may already be correct (in which case skip this
  step) or pointed at the wrong URL/key; either way `cron.schedule` with the same job name
  updates it in place, so it's safe to re-run.
- **A row naming `sendTenderReminders` or `sendRfiReminders`** → note it, you'll need it for
  step 4.

Then run the block in
[`supabase/migrations/008b_cron_setup.INSTRUCTIONS.md`](supabase/migrations/008b_cron_setup.INSTRUCTIONS.md)
(now updated with a paragraph on why the 19:00 UTC slot is safe — don't move that time
without reading it first).

## 4. Delete the two dead functions

Only after step 3 confirms nothing in `cron.job` points at them:

```bash
supabase functions delete sendTenderReminders --project-ref axrknhdinnjhrjrmwher
supabase functions delete sendRfiReminders --project-ref axrknhdinnjhrjrmwher
```

These were deleted from the repo by commit `45c32a7` but are still live on the project,
still sending their own older, unfixed reminder emails if anything ever calls them.

## 5. Test script

Run through this in order. Steps 2, 4, and 6 send a real email to whatever address you use
as the scratch invitee — use one you control.

1. **Settings → Reminders → Run now** on a day with no tender closing soon. Expect
   `sent: 0` and a `details[]` full of `outside window`. The "Last run" line above the
   button updates to show the new run.
2. Set a scratch **Issued** tender's closing date to **the day after tomorrow**, with one
   invitee. Run now → the external reminder sends (`days_before = 2` by default), the body
   reads *"in 2 days"* (not *"2 day(s)"*), and the link opens the portal. The internal
   reminder does **not** send yet (its default window is 1 day).
3. Run now again → external is skipped as `already sent (dedup)`.
4. Move that tender's closing date **out by a week**. Run now → external sends again for the
   new date (this is the Phase 3 fix — the old dedup key had no date in it and would have
   silently skipped this forever).
5. Set closing to **tomorrow**. Run now → internal sends to you + other admins, reads
   *"closes tomorrow"* (not *"closes in 1 day(s)"*), and the submitted/invited counts are
   correct.
6. **Decline** as the sub in the portal, then Run now → that sub is now skipped with reason
   `declined` instead of getting nagged again.
7. **Next morning**, confirm the cron fired on its own: the "Last run" line in Settings shows
   a `cron`-triggered run, not just your manual ones.

## What to check yourself (I can't see these)

- **Custom email templates.** If `email_templates` has rows for `tender_reminder_internal`,
  `tender_reminder_external`, or `rfi_reminder`, those override the inline fallback wording
  the Phase 2 fix corrected. Check Settings → Email Templates for stale "day(s)" phrasing in
  any of the three and edit them there — I can't see or change DB rows.
- **First run after deploy may re-send one reminder per in-window tender.** The Phase 3 dedup
  key changed shape (it now includes the closing date), so old log rows are inert. This is a
  one-off, expected, and correct — not a bug.

## Everything delivered, by phase

| Phase | What | Deploy needed |
|---|---|---|
| 1 | "Run reminders now" button + results table + "Recently sent" log in Settings | No |
| 2 | Fixed NZ-timezone off-by-one in days-until math; "closes today/tomorrow/in N days" wording | Yes |
| 3 | Dedup key includes closing date; dedup/log-insert failures now fail closed | Yes |
| 4 | Declined subs and disabled staff stop getting reminded | Yes |
| 5 | Every remaining silently-discarded query error now surfaces in `details[]` or the response | Yes |
| 6 | `reminder_runs` table + "Last run" indicator in Settings; cron docs updated; this handover | Yes (029 + deploy) |

## Out of scope (flagged, not built — see plan for why)

- F4 proper (the `tender_invitations` CHECK constraint) — owned by `PLAN_APP_AUDIT_2026-07-18.md`.
- Per-user reminder opt-out.
- Escalating reminders (multiple windows per type).
- Driving reminders off `ths_rft_closing_date` instead of `closing_date`.
