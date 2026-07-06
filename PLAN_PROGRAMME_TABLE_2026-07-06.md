# Programme table & Look Ahead upgrades — implementation plan (2026-07-06)

**Implementer:** Sonnet (or any agent). **Work one phase at a time. STOP at the end of every
phase**, commit (do NOT push), and report back to Tim. Another agent may pick up the next
phase, so each phase description is self-contained.

Confirmed with Tim (2026-07-06):
1. Task table becomes a **full spreadsheet grid** — arrow/Tab/Enter cell navigation, editable
   Name / Days / Start / Predecessors / %, Enter on the last row starts a new task inline.
2. "Upgrade child to parent" = **MS Project-style outdent**: the task moves up one level and
   its former following siblings become its children. Both Indent and Outdent are exposed.
3. Predecessors use **WBS numbers everywhere** — table display, print view, Excel export, AND
   typed input (e.g. `1.2.3FS+2d`).
4. Look Ahead in All Projects shows a **two-line row**: project name in small text above the
   task name.

---

## Ground rules (apply to every phase)

- **All schedule mutations go through `src/lib/scheduleUpdateService.js`** (`updateTaskFull`,
  `updateTaskDuration`, `updateTaskStartDate`, `updateTaskDependency`, `updateTaskProgress`).
  Never call `Task.update()` directly for dates/duration/predecessors/progress/name — the
  service runs the CPM engine, persists the cascade, and writes the audit trail.
- **Row alignment invariant:** `TaskList` and `GanttChart` both render from the same
  pre-computed `visibleTasks` array (built in `Programme.jsx` via `getVisibleTasks`), with row
  height `ROW_HEIGHT = 32` exported from `TaskList.jsx`. Nothing in this plan may change row
  height or make the two panes disagree on row order/count.
- **Dates:** never use `toISOString()` for calendar dates (NZ timezone shifts them). Use the
  local `formatLocal`/`todayStr` pattern already in the codebase.
- **Permissions:** editing is gated by `programmeEditable` (`canEdit(user,'programme') &&
  selectedProjectId !== 'all'`) — reuse this flag; read-only users keep current behaviour.
- **No DB migrations.** Everything in this plan works with the existing schema
  (`tasks.parent_id/level/sort_order/wbs`, `task_dependencies`, existing RPCs
  `bulk_update_task_schedule` / `bulk_update_task_wbs`). If you believe you need new SQL, STOP
  and ask Tim — he runs migrations manually in the Supabase editor.
- **Verification:** run `npm run lint` and `npm run test` (vitest) after each phase. Do NOT use
  preview_* browser tooling — Tim verifies in his own browser. In the phase report, list the
  exact manual checks Tim should do.
- **Git:** one commit per phase, message style matching recent history (imperative, scoped).
  Never push unless Tim says "push".

Key files:

| File | Role |
|---|---|
| `src/pages/Programme.jsx` | page state, engine runs, mutation handlers, tab layout |
| `src/components/programme/TaskList.jsx` | the task table (left pane) |
| `src/components/programme/GanttChart.jsx` | pure renderer, right pane |
| `src/components/programme/LookAhead.jsx` | Look Ahead tab |
| `src/components/programme/TaskInlineEditor.jsx` | task edit sheet |
| `src/components/programme/AddTaskDialog.jsx` | dialog task creation (has sort-order + WBS-renumber logic to reuse) |
| `src/components/programme/TaskContextMenu.jsx` | **exists but is wired to nothing** — right-click menu with insert/indent/outdent/milestone/delete |
| `src/components/programme/ProgrammePrintView.jsx` | print layout (uses `predecessorLabel`) |
| `src/lib/scheduleExport.js` | `predecessorLabel()` + Excel/MSPDI export |
| `src/lib/wbsUtils.js` | `computeWBS`, `indentTask`, `outdentTask` (**currently unused**) |
| `src/lib/scheduleUpdateService.js` | single source of truth for schedule mutations |
| `src/api/programmeData.js` | fetch/persist: `setTaskDependencies`, `bulkUpdateSchedule`, `bulkUpdateTaskWbs` |

---

## Phase 1 — "Predecessors" column, labelled with WBS numbers

**Goal:** rename the table column "Dependencies" → "Predecessors", and everywhere a
predecessor list is shown as text, use WBS numbers (`1.2.3FS+2d`) instead of flat row numbers.

Current state: `predecessorLabel(preds, idToRowNum)` in `src/lib/scheduleExport.js:217` builds
`12FS+2d` from a Map of task id → row number. Callers:
- `TaskList.jsx:110-114` builds `rowNumMap` from the fully-expanded visible order, uses it at
  line 177; header cell says "Dependencies" at line 155.
- `ProgrammePrintView.jsx:268` (its own `rowNumMap`).
- `buildProgrammeWorkbook` in `scheduleExport.js:240` (Excel export).
- The MSPDI XML export uses UIDs, **not** `predecessorLabel` — leave it alone.

Steps:
1. In `scheduleExport.js`, keep `predecessorLabel(preds, idToLabel)` generic (it just looks up
   a Map) — no signature change needed. Add a small exported helper next to it:
   ```js
   export function wbsLabelMap(tasks) {
     // task.id -> task.wbs; fall back to outline row number when wbs is missing
   }
   ```
   Fallback matters: freshly created tasks can briefly lack `wbs`. Use `outlineOrder`
   (already in that file) for the fallback numbering.
2. `TaskList.jsx`: replace the `rowNumMap` memo with `wbsLabelMap(tasks)`; rename the header
   cell text to `Predecessors`.
3. `ProgrammePrintView.jsx`: same swap for its `rowNumMap`, and rename its column header if it
   says "Dependencies"/"Preds" (check `pp-col-preds` header text).
4. `buildProgrammeWorkbook`: pass the WBS map so the Excel "Predecessors" column shows WBS.
   Keep the existing `ID` and `WBS` columns as-is.
5. Tests: add `src/lib/__tests__/predecessorLabel.test.js` (or extend an existing suite)
   covering: WBS lookup, lag formatting (`+2d`, `-1d`, none), missing predecessor filtered
   out, fallback numbering when `wbs` is null.

**Manual checks for Tim:** open a project's Gantt — the column header reads "Predecessors" and
values look like `2.1FS+2d`; print preview and Excel export show the same labels.

**STOP. Commit. Report.**

---

## Phase 2 — Look Ahead: project name above task name (All Projects)

**Goal:** in the Look Ahead tab with "All Projects" selected, each task row shows which
project it belongs to — project name in small muted text on top, task name below.

Current state: `LookAhead.jsx` receives `tasks` (already cross-project when 'all' is
selected) but has no access to project names. `Programme.jsx:748-756` renders it; the page
already holds `projects` (id + name) and `selectedProjectId`.

Steps:
1. `Programme.jsx`: pass two new props to `<LookAhead>`:
   `projectsById={useMemo(() => new Map(projects.map(p => [p.id, p.name])), [projects])}` and
   `showProject={selectedProjectId === 'all'}`.
2. `LookAhead.jsx` `TaskRow`: when `showProject`, render above the task-name line:
   `<span className="text-[9px] text-muted-foreground uppercase tracking-wide truncate">{projectsById.get(task.project_id) || '—'}</span>`
   Keep the row a fixed-ish height — the row already has two lines (name + dates); project
   name becomes the first line of the middle flex column. Verify it doesn't break the mobile
   layout (the row is a flex, not a grid — just add the line inside the existing
   `flex-1 min-w-0` div).
3. Also add the project name under the same condition to the **Milestones** side panel entries
   (small, truncated), since those are cross-project too.

**Manual checks for Tim:** Programme → All Projects → Look Ahead: every row shows the project
name above the task name; selecting a single project hides it.

**STOP. Commit. Report.**

---

## Phase 3 — WBS predecessor parser + editable Predecessors cell

**Goal:** users can type predecessors as WBS strings (`1.2FS+2d, 3.1SS-1d, 5`) directly in the
table's Predecessors cell; the same parser backs any future input surface.

Steps:
1. New lib `src/lib/programme/predecessorParse.js`:
   ```js
   /**
    * Parse "1.2FS+2d, 3.1SS-1d, 5" into engine-shape predecessors.
    * @param {string} input
    * @param {Map<string, string>} wbsToId  — task.wbs -> task.id
    * @returns {{ preds: Array<{predecessor_id,type,lag_days,lag_hours,is_elapsed}>, errors: string[] }}
    */
   export function parsePredecessorInput(input, wbsToId) { ... }
   ```
   Rules: entries split on `,`/`;`; each entry = WBS (digits and dots), optional type
   (`FS|SS|FF|SF`, case-insensitive, default FS), optional lag (`+Nd`/`-Nd`/`+N`/`-N`,
   default 0). Unknown WBS → error naming the bad token. Empty input → `{ preds: [] }`
   (clears all). Trim whitespace. Do NOT validate cycles here — `updateTaskDependency`
   already rejects self-links and cycles with good messages.
2. Unit tests `src/lib/__tests__/predecessorParse.test.js`: happy path, multiple entries,
   default type/lag, negative lag, lowercase `fs`, unknown WBS error, empty string, garbage
   token error, whitespace tolerance.
3. `TaskList.jsx`: add a `PredecessorCell` modelled on the existing `DurationCell`
   (lines 22-70): click to edit (when `editable` and the task is a leaf — summaries show `—`
   and are not editable), text input pre-filled with the current label, commit on
   Enter/blur, Escape cancels. On commit: build `wbsToId` (invert the Phase-1 map), run the
   parser; if errors, toast destructive and keep the old value; else call a new
   `onPredecessorsCommit(taskId, preds)` prop.
4. `Programme.jsx`: add `handlePredecessorsCommit` calling
   `updateTaskDependency(taskId, preds, tasks, scheduleOptions)` with the same
   try/`afterScheduleChange`/toast shape as `handleCreateDependency` (line 251), and pass it
   to both `<TaskList>` instances (desktop + mobile).
5. Milestones CAN have predecessors — allow editing on milestone rows too (only summaries are
   excluded).

**Manual checks for Tim:** click a Predecessors cell, type `1.2FS+2d`, Enter — the Gantt
re-schedules and the arrow appears; typing an unknown WBS shows an error toast and reverts;
creating a loop shows the circular-dependency toast.

**STOP. Commit. Report.**

---

## Phase 4 — Spreadsheet grid: cell cursor + keyboard navigation + remaining editable cells

**Goal:** the task table behaves like Excel/MS Project: a visible cell cursor you move with
the keyboard, and in-place editing of Name, Days, Start (Pln Start), Predecessors and %.

This is the biggest UI phase. All of it lives in `TaskList.jsx` + handlers in
`Programme.jsx`. The Gantt pane is untouched.

Design:
1. **Cell model.** Editable column keys in order: `name`, `duration`, `start`, `preds`,
   `pct`. Grid cursor state `{ rowIdx, colKey }` plus `editing: boolean`, kept in `TaskList`
   (local state — it does not need to survive tab switches). Only active when `editable`.
2. **Navigation** (when not editing): Arrow keys move the cursor (up/down clamp to
   0..visibleTasks.length-1, left/right across the editable columns); `Tab`/`Shift+Tab` same
   as right/left; `Enter` or `F2` or double-click starts editing; typing a printable
   character starts editing with that character (replace mode, like Excel); `Escape` clears
   the cursor. While editing: `Enter` commits and moves down one row (same column), `Tab`
   commits and moves right, `Escape` cancels. Attach one `onKeyDown` on the scroll container
   (make it focusable, `tabIndex={0}`, `outline-none`) rather than per-cell listeners.
   Keep the cursor cell scrolled into view (`scrollIntoView({ block: 'nearest' })`).
3. **Single click** on any cell sets the cursor to that cell (no edit). This replaces the
   current row-click → `onTaskClick` behaviour **when `editable`**: opening the
   task progress panel is still available via the row's pencil icon and via clicking the
   Gantt bar. When not `editable`, row click keeps opening the panel exactly as today.
   (State this in the phase report so Tim knows the interaction changed.)
4. **Cell editors and commit routes** (all already exist or were built in Phase 3):
   - `name` → editable for every task incl. summaries. Commit via a new
     `onNameCommit(taskId, name)` → `updateTaskFull(taskId, { name }, tasks, scheduleOptions)`
     in `Programme.jsx` (non-schedule change → fast path, no cascade).
   - `duration` → reuse `DurationCell` logic (leaf-only, min 1) → existing
     `handleResizeTask`. Milestones and summaries show `—`.
   - `start` → date input (`type="date"`), leaf + milestone only (summaries derive) →
     existing `handleMoveTask` (sets SNET constraint — that is intended behaviour, same as
     dragging the bar).
   - `preds` → Phase 3 `PredecessorCell` (leaf + milestone).
   - `pct` → number 0-100, leaf-only (summary % is rolled up) → new
     `onProgressCommit(taskId, pct)` → `updateTaskProgress(taskId, pct, tasks, scheduleOptions)`.
   Non-editable cells for a given row (e.g. duration on a summary) are still valid cursor
   positions but render read-only and ignore edit keys — simpler and more Excel-like than
   skipping them.
5. **Visuals:** cursor cell gets a ring (`ring-1 ring-primary ring-inset` or a border) —
   subtle, must not shift layout. Keep `ROW_HEIGHT = 32`.
6. **Refactor tip:** extract a generic `EditableCell` (display renderer + editor renderer +
   commit fn + `canEdit(task)`) so `DurationCell`/`PredecessorCell` collapse into configs,
   but do not over-engineer — five columns, one file is fine.
7. **Expand/collapse while cursor is set:** cursor is `{rowIdx}`-based against
   `visibleTasks`; when `visibleTasks` changes length, clamp `rowIdx`. Losing the precise
   task under the cursor after collapse is acceptable.

**Manual checks for Tim:** click a cell → ring appears; arrows/Tab/Enter move it; type over a
Name; edit Days/Start/%/Predecessors from the keyboard only; summaries reject
duration/start/% edits; read-only user (or All Projects) sees the old behaviour.

**STOP. Commit. Report.**

---

## Phase 5 — Inline new task row (Enter past the last row)

**Goal:** while building a programme you never need the Add Task dialog: an always-present
ghost row at the bottom of the table ("Add task…"); typing a name there and pressing Enter
creates the task and keeps the cursor moving.

Steps:
1. Extract the creation logic from `AddTaskDialog.jsx` (`computeSortOrder`, the
   `Task.create` payload at lines 87-102, and the WBS-renumber block at lines 117-130) into
   `src/lib/programme/createTask.js`:
   ```js
   export async function createTaskInline({ projectId, name, tasks, scheduleOptions,
     parentId = null, predecessor = null, duration = 5, isMilestone = false })
   ```
   Refactor `AddTaskDialog` to call it (behaviour identical — keep its predecessor-linking
   step, which the inline path simply won't use).
2. `TaskList.jsx`: when `editable`, render one extra ghost row below the last task (inside
   the scroll area, above the 50px spacer): muted "Add task…" placeholder in the Name column.
   It participates in cursor navigation as the last row (Name cell only). Typing/Enter opens
   a text editor; committing a non-empty name calls a new `onCreateTask(name)` prop; empty
   commit does nothing. After the row is created and tasks refetch, keep the cursor on the
   ghost row so Enter-name-Enter-name chains work.
3. `Programme.jsx`: `handleCreateInline(name)` → `createTaskInline({ projectId:
   selectedProjectId, name, tasks, scheduleOptions })`, `invalidateQueries(['tasks'])`,
   destructive toast on error. New tasks land at root level, appended last, start = data
   date/today, 5d duration — same defaults as the dialog.
4. **Gantt alignment:** the ghost row exists only in `TaskList`, which would desync row
   backgrounds. Fix: the ghost row must NOT be part of `visibleTasks`; it renders after the
   mapped rows, and `GanttChart`'s `chartHeight` already overshoots by 50px, which covers one
   32px row — verify scroll sync still lines up (the TaskList bottom spacer may need to
   shrink from 50 to 50 − 32 = 18px when the ghost row shows).
5. Enter on the last real row's Name column moves the cursor to the ghost row (natural
   consequence of it being row N).

**Manual checks for Tim:** type three task names Enter-Enter-Enter — three tasks appear with
sequential WBS at root level and bars on the Gantt; rows stay aligned with the chart when
scrolled to the bottom; Add Task dialog still works unchanged.

**STOP. Commit. Report.**

---

## Phase 6 — Indent / Outdent + promote child to parent (MS Project semantics)

**Goal:** right-click a row (and keyboard shortcuts) to indent/outdent. Outdenting a child
promotes it one level and its former following siblings become its children — Tim's "upgrade
a child task to a parent task".

Current state: `wbsUtils.js` has `indentTask`/`outdentTask` and `TaskContextMenu.jsx` has the
menu — **neither is wired to anything**, and `outdentTask` does NOT re-parent following
siblings, so it must be fixed first.

Steps:
1. **Fix `outdentTask` in `src/lib/wbsUtils.js`** to MS Project semantics. For task X with
   parent P (grandparent G = `P.parent_id || null`):
   - X: `parent_id = G`, `level = max(level-1, 0)`, `sort_order = P.sort_order + 0.5`
     (fractional insert after P, as the existing code does).
   - Every former sibling S of X (same parent P) with `sort_order > X.sort_order`:
     `parent_id = X.id` (level and sort_order unchanged — they keep their depth, which is now
     one below X).
   - Return the full patch array `[{ id, parent_id, level, sort_order?, wbs }]` for X **and**
     the re-parented siblings, with fresh WBS for every task whose WBS changed (run
     `computeWBS` on the merged list and diff, like `AddTaskDialog` does — an outdent
     renumbers cousins too, not just the moved subtree).
   - Descendants of X keep `parent_id` but their `level` values are now wrong if you track
     level as absolute depth — check: X's level dropped by 1, X's existing children's stored
     `level` is unchanged, so it no longer equals depth. `getVisibleTasks`/`TaskList` use
     `task.level` for indentation, so **recompute `level` for X's whole subtree** (depth walk
     over the merged list) and include those patches. Same in `indentTask` (subtree level +1,
     capped at 3 — the existing cap; keep it).
2. **Unit tests** `src/lib/__tests__/wbsUtils.test.js` (create if missing): outdent
   mid-list child → following siblings become its children, previous siblings stay; outdent
   root task → no-op; indent first sibling → no-op; WBS renumbering correct after each;
   subtree levels correct; existing children of X stay under X through both operations.
3. **Persistence** in `Programme.jsx` — `handleHierarchyChange(patches)`:
   - Split patches: `{ id, wbs }` pairs go through `bulkUpdateTaskWbs` (existing RPC);
     `parent_id/level/sort_order` fields go through chunked `Task.update` calls
     (`Promise.all` in chunks of 20, like `bulkUpdateSchedule`'s fallback). Set
     `bulkOperationState.active = true` around it so the 30s poll doesn't refetch mid-write.
   - Then `invalidateQueries(['tasks'])`. No engine call needed — hierarchy affects rollups,
     which recompute client-side from the refetched list.
   - Also expand the new parent (`setExpandedIds` add X.id) so the promoted task's children
     stay visible.
4. **Wire `TaskContextMenu`** around each row in `TaskList.jsx` (only when `editable`),
   with an `onAction(action, task)` prop up to `Programme.jsx`:
   - `indent` / `outdent` → `indentTask`/`outdentTask` + `handleHierarchyChange`. Empty patch
     array (illegal move) → quiet no-op toast ("Can't indent further").
   - `insert-above` / `insert-below` → Phase 5 `createTaskInline` with the same parent as the
     clicked task and a fractional `sort_order` beside it (extend `createTaskInline` with an
     `anchor: { task, position: 'above'|'below' }` option).
   - `convert-milestone` → `updateTaskFull(task.id, { is_milestone: true, duration: 0 }, …)`;
     blocked for summaries (toast).
   - `delete` → existing `Task.delete` mutation pattern (leaf-only, as the table already
     enforces).
5. **Keyboard shortcuts** (grid cursor set, not editing): `Alt+Shift+ArrowRight` = indent,
   `Alt+Shift+ArrowLeft` = outdent (MS Project bindings; plain Tab is taken by cell nav).
6. Note: a task that gains children automatically renders as a summary (summary detection is
   derived from `parent_id`s) and the engine rolls it up on the next run — no flags to set.

**Manual checks for Tim:** right-click a child task → Outdent: it becomes a parent, tasks
below it become its children, WBS renumbers, Gantt shows a summary bar; Indent reverses it;
insert above/below lands beside the row; Alt+Shift+arrows work; delete/milestone actions work.

**STOP. Commit. Report.**

---

## Out of scope / explicitly not touched

- MSPDI XML export (uses MS Project UIDs — unaffected by the WBS label change).
- Schedule engine (`src/lib/scheduling/*`) — no changes in any phase.
- DB schema / migrations / RPCs — none required.
- Mobile grid keyboard navigation (grid is pointer-only on mobile; inline editors still work).
