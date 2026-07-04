# Handover: Programme Engine — Phase 6 (Mobile Field Progress View)

Branch: `programme-engine` (do NOT push to main; commit locally). Plan file:
`~/.claude/plans/build-brief-native-memoized-parnas.md`. Phases 1–5 complete and committed
(data model + migrations 006/007 RUN LIVE, CPM engine + 70 Vitest tests, MSPDI import/export,
Gantt authoring UI, baselines). Stop after Phase 6 with a terse checkpoint; keep words minimal.

## What Phase 6 builds

Mobile-first progress capture for site crews (internal/pricing/admin only — external users are
strictly read-only, no /field access).

1. **`src/pages/FieldProgress.jsx`**, route `/field` in `src/App.jsx` (inside authed layout).
   Sidebar entry gated to admin/pricing/internal (`src/components/layout/` — follow existing
   gating patterns). A "Field view" button on Programme page when `useIsMobile()`.
2. Card list, filter tabs: **My tasks** (`assignee_email === user.email`), **This week**
   (planned dates within the week from the engine), **By assignee** (grouped). Card: name/WBS,
   planned dates, %, status chip. NO Gantt on this page.
3. **`src/components/programme/QuickProgressSheet.jsx`** (vaul drawer, already a dep):
   0/25/50/75/100 quick buttons + fine slider, note textarea, photo capture
   (`<input type="file" accept="image/*" capture="environment">` → `uploadFile(file,
   'project-files')` from `src/api/supabaseClient.js` — returns a PATH, store it, sign at view
   time via useSignedUrl). **Delay-reason select appears automatically** when the update implies
   lateness (planned finish < today and % < 100, or completing after planned finish) — optional,
   one tap, values must match the DB check: weather/materials/labour/design_change/
   client_variation/site_access/other.
4. Save flow: insert `task_progress_log` row (`TaskProgressLog` entity from `src/api/entities.js`:
   task_id, project_id, updated_by = auth uid, previous_percent, new_percent, note, delay_reason,
   photo_path) → then `updateTaskProgress(taskId, pct, allTasks, options)` from
   `src/lib/scheduleUpdateService.js` (it cascades real slips automatically) → toast →
   invalidate `['tasks']`. Target: update in <10s on a phone.

## Key APIs (all exist — do not reinvent)

- `fetchProgrammeTasks(projectId|'all')` in `src/api/programmeData.js` — tasks with engine-shape
  `predecessors` + `constraint` attached.
- `updateTaskProgress(taskId, percent, allTasks, { userId, projectStart, calendar, dataDate })`
  in `src/lib/scheduleUpdateService.js`. Build options like Programme.jsx does
  (`calendarForProgramme(programme, tasks)` from `src/lib/scheduling/scheduleEngine.js`,
  programme row via `fetchProgramme`).
- `runScheduleEngine(tasks, projectStart, calendar, { dataDate })` for planned dates on cards.
- Permissions: `src/lib/permissions.js` (roles admin/pricing/internal/external via `getRole`).
- RLS already enforces: progress-log insert = admin/pricing/internal with updated_by = auth.uid().

## Workflow rules (Tim's standing instructions)

- Delegate the presentational card/sheet UI to a Sonnet/Opus subagent with a written spec;
  keep the save-flow wiring through scheduleUpdateService with the main agent. Review before commit.
- Tim runs all SQL manually (none expected for Phase 6) and runs manual tests himself — do NOT
  drive the browser; `npm test` + `npm run build` + eslint on changed files is the verification bar.
- Commit with a message FILE (`git commit -F`) — inline here-strings with quotes have broken before.
- Test login (Tim's, if preview needed): tim@thshb.co.nz / Test1234.

Phase 7 (E2E pass with a real MSPDI file) remains after this.
