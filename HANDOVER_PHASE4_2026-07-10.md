# ConstructIQ — Phase 4 handover (2026-07-10)

Part of the 6-phase bug-fixes & upgrades plan (memory: `bug-fixes-upgrades-2026-07-10`).
Phase 4 is **committed locally**, **not pushed** — waiting for Tim's "push".

**Needs a DB migration**: `supabase/migrations/012_programme_publish.sql` — not
yet run by Tim.

## What got done

**Programme publish / edit-lock (not draft versioning) + notification email.**

1. **Migration `012_programme_publish.sql`**:
   - `programmes` gets `status` (`'draft'`|`'published'`, default `'draft'`),
     `published_at`, `published_by_id`.
   - `publish_programme(project_id)` — callable by admin/internal/pricing.
     `unpublish_programme(project_id)` — **admin only**. Both are
     `security definer` RPCs; they're the *only* way to change
     `status`/`published_at`/`published_by_id` — direct client updates to
     those columns are blocked via column-level `revoke/grant` on
     `programmes` (the app can still write `name`/`data_date`/`calendar`
     directly, unchanged).
   - Lock enforcement is a **BEFORE trigger** on `tasks` and
     `task_dependencies` (`enforce_programme_lock`/`_deps`), not a plain RLS
     `USING` clause — a trigger can diff OLD vs NEW per column, which RLS
     can't. This means publishing freezes **schedule-affecting** fields
     (`start_date`, `end_date`, `duration`, `is_milestone`, `parent_id`,
     `sort_order`, `wbs`, `level`, `name`) and blocks task insert/delete and
     all `task_dependencies` writes, while **progress-tracking fields stay
     editable** (`percent_complete`, `actual_start`, `actual_finish`,
     `task_status`, `delay_days`, `status_notes`, `delay_notes`,
     `assignee_name/email`) — so the team can still record progress against
     a published baseline. Admins bypass the lock entirely (can always edit
     and are the only role that can unpublish).
   - Because the trigger lives on the base tables, it's automatically
     honoured by `bulk_update_task_schedule`/`bulk_update_task_wbs` (both
     `security invoker`) — no separate gate needed there.
   - `project_activity.entity_type` check constraint extended to allow
     `'programme'` (for the publish-event log entry written by the edge
     function).

2. **New edge function `notifyProgrammePublished`**
   ([index.ts](supabase/functions/notifyProgrammePublished/index.ts)) — same
   shape as `sendOutcomeNotifications`: JWT auth, role-gated
   (admin/internal/pricing), Resend send, `email_templates` override lookup
   (`template_key = 'programme_published'`, inline default fallback),
   `email_branding` wrapper, recipients = every unique `user_email` in
   `projects.team` (there's no separate team table — confirmed during
   research, `team` JSONB is the single source of truth for both staff and
   subcontractors on a project). Logs a `project_activity` row
   (`entity_type: 'programme'`) with send counts. Not yet deployed.

3. **Frontend** ([Programme.jsx](src/pages/Programme.jsx)):
   - `programmeLocked = programme?.status === 'published'`; `lockedForMe`
     also checks `!isAdmin`. `programmeEditable`/`taskEditable`/
     `canDeleteTasks` all gain `&& !lockedForMe` — this alone propagates the
     lock everywhere (Add Task, Schedule Settings, Baseline Manager,
     TaskList/GanttChart's `editable`/`canDeleteTasks` props, inline delete
     in `TaskInlineEditor`) since all of those already consumed these same
     flags for role-based gating.
   - Toolbar: amber "Published" badge + **Publish** button
     (admin/internal/pricing, hidden once published) and **Unpublish**
     button (admin only, shown once published). Publish calls
     `publishProgramme()` (RPC), invalidates the `programme`/`programmes`
     queries, toasts, then fires `notifyProgrammePublished` **fire-and-forget**
     (`.catch(() => {})`) so an email hiccup never blocks the publish action
     itself.
   - New API helpers in
     [programmeData.js](src/api/programmeData.js#L184): `publishProgramme`,
     `unpublishProgramme`.

## Design decisions made (not re-litigated, but worth knowing)
- **Publish = admin/internal/pricing; unpublish = admin only.** Reopening a
  published schedule is treated as more sensitive than closing it —
  mirrors the existing `programmes_delete`/`task_baselines_delete` pattern
  (admin/pricing-only for destructive-ish actions).
- **Progress tracking stays open on a published programme.** This was a
  judgment call, not explicit in the phase-4 spec — publishing a schedule
  in real construction workflows doesn't mean nobody can record % complete
  or actual dates against it anymore. If Tim wants progress *also* locked,
  that's a one-line change: fold the progress columns into the same
  changed-column check in `enforce_programme_lock()`.
- **DB trigger, not RLS**, is the enforcement mechanism specifically because
  RLS can't cheaply distinguish "only progress fields changed" from
  "someone dragged a task bar" on the same UPDATE statement.

## Verified so far
- `npx eslint` on all touched JS files — 0 errors (1 pre-existing unrelated
  warning, `DELETE_CHUNK` unused, not introduced by this change).
- `npx vite build` — succeeds, no new warnings.
- Edge function is Deno (not tsc-checkable locally) — reviewed by hand,
  mirrors the already-working `sendOutcomeNotifications` structure closely.
- **Not yet run against the live DB** and not yet verified in browser
  (memory: no preview_* testing, Tim verifies manually).

## Next steps for Tim
1. Run `supabase/migrations/012_programme_publish.sql` in the Supabase SQL
   editor. The verification queries at the bottom of the file show how to
   confirm the columns/triggers landed.
2. Deploy the new edge function: `supabase functions deploy
   notifyProgrammePublished`.
3. Verify in browser:
   - Open a project's Programme tab as admin/internal/pricing → click
     **Publish** → toolbar should show a "Published" badge, task bars/rows
     should become read-only (no drag, no inline edit, no Add Task, no
     delete), and team members on that project should receive an email.
   - As a non-admin, confirm you can *still* record progress (Quick
     Progress / Progress panel) on a published programme.
   - As admin, click **Unpublish** → schedule should become editable again.
   - As non-admin (internal/pricing), confirm the Unpublish button is
     hidden — only admin can unlock.
4. Once confirmed, say "push" to push `main`.
5. Then green-light Phase 5 (printing engine rebuild — Fable/careful-Opus
   territory) or Phase 6 (optional engine hardening, Fable only, not yet
   committed to).

## Where things stand in the 6-phase plan
- ✅ Phase 1 — done, committed `35c6e06`.
- ✅ Phase 2 — done, committed `fec9921`.
- ✅ Phase 3 — done, committed `e29a4e8`. Still pending Tim's function
  redeploy + verification + push (per its own handover) — **push covers
  phases 3 and 4 together** since neither has been pushed yet.
- ✅ Phase 4 — done (this handover), pending Tim's migration run + function
  deploy + verification + push.
- ⬜ Phase 5 — Printing engine rebuild. Not started.
- ⬜ Phase 6 (optional) — engine hardening. Not committed to.
