# ConstructIQ — Phase 5 handover (2026-07-10)

Part of the 6-phase bug-fixes & upgrades plan (memory: `bug-fixes-upgrades-2026-07-10`).
Phase 5 is **committed locally**, **not pushed** — waiting for Tim's "push".
**No DB migration.**

## What got done

**Printing engine rebuild: multi-page vector PDF, replacing `window.print()`.**

1. **New module** [`src/lib/programme/pdfExport.js`](src/lib/programme/pdfExport.js)
   — `exportProgrammePdf({ tasks, scheduledMap, programme, projectName,
   baselineMap, criticalOnly })`. Draws directly with jsPDF's vector
   primitives (rect/line/text/polygon) — no `svg2pdf.js` dependency added;
   jsPDF alone gives full control over pagination and stays vector
   throughout, so the extra library wasn't needed.
   - **MS-Project-style tiling**: the schedule is a grid of A4-landscape
     tiles — row bands (down) x date bands (across). Every tile repeats the
     task-table columns (#, WBS, Name, Dur, Start, Finish, %, Preds, Float)
     on the left so any page identifies its rows, and shows the timeline
     slice for its date band on the right, with a `Page X of Y` /
     `Rows a–b` / date-range locator in the header so pages can be
     reassembled by hand.
   - Row/date bucket sizing is fixed (5mm rows, ~1/4.5/1mm-per-day tiers by
     schedule length) rather than computed from viewport size — deterministic
     page counts, same approach the old `ProgrammePrintView` used for its
     week/month/year timeline-tier logic, just extended to tile instead of
     squeeze.
   - Same visual language as the old CSS print view: critical (red),
     summary (dark), milestone (indigo diamond), baseline (dashed gray),
     data-date/today lines (amber/blue dashed), dependency arrows colored by
     type (`DEP_COLORS` from `GanttChart.jsx`, both-critical pairs in red),
     percent-complete fill overlay on bars.
   - **Known limitation**: a dependency arrow only draws when both ends
     land on the *same* tile (same row band **and** date band). An arrow
     whose predecessor and successor fall on different pages isn't
     connected — the same physical constraint a paper printout has. This
     was true of the interactive-DOM-measurement version too (it only had
     one giant page), so this is a new limitation introduced by tiling, not
     a regression from something that worked before.
2. **`Programme.jsx`** — `handlePrint` now calls `exportProgrammePdf(...)`
   directly (wrapped in `setTimeout(0)` so the button's pulse-spinner state
   paints before the synchronous draw loop runs) instead of setting
   `isPrinting` and calling `window.print()`. The Printer toolbar button
   title changed to "Export PDF"; the old `isPrinting` portal-mount /
   `afterprint` listener / print-media-query fallback effect is gone.
3. **Removed as dead code** (fully replaced, not just unused):
   `src/components/programme/ProgrammePrintView.jsx` (deleted) and the
   `@media print` block + `.programme-print-portal` rules in
   [`src/index.css`](src/index.css) (removed, ~105 lines).
4. **New test**: [`src/lib/programme/pdfExport.test.js`](src/lib/programme/pdfExport.test.js)
   — 6 scenarios (week/month/year timeline tiers, multi-row-band tiling,
   `criticalOnly` filter, empty task list, missing `scheduledMap` entries).
   Caught and fixed a real bug during verification: dependency-arrow
   predecessor lookup (`rowIndexInBand`) was a single `Map` reused across
   every row band, so a task's local row index from a *previous* page's
   tile leaked into the next page's lookup and indexed the wrong
   (or out-of-range) task — fixed by scoping that `Map` per row band.

## Verified so far
- `npx eslint` on all touched files — 0 errors (same pre-existing
  `DELETE_CHUNK` warning, unrelated).
- `npx vite build` — succeeds, no new warnings.
- `npx vitest run` — full suite 120/120 passing (was 114 before the 6 new
  tests).
- **Actually generated a real PDF** during the test run (jsdom provides
  enough of `document` for `file-saver` to write a file) and extracted its
  text layer with `pdfjs-dist` (installed with `--no-save`, not added to
  `package.json`, removed afterward) to confirm real content renders
  correctly: header/meta/legend, column headers, timeline month labels,
  task rows with correct WBS/name/dates/%, predecessor labels in
  `12FS+2d`-style notation, and the deliberately-broken "missing
  `scheduledMap` entry" row rendering `—` instead of crashing. No PDF page
  rasteriser (poppler) was available in this environment to eyeball pixel
  layout directly — the text-layer + geometry-smoke-test combination is the
  verification that was possible here.
- **Not yet clicked in the real browser** (memory: no preview_* testing,
  Tim verifies manually).

## Design decisions made (not re-litigated, but worth knowing)
- **jsPDF only, no `svg2pdf.js`.** The original phase-5 one-liner named
  `jsPDF + svg2pdf.js`; drawing tiles directly with jsPDF's own primitives
  gave simpler, more precise control over per-tile clipping/pagination math
  than converting an SVG/DOM subtree per tile would have, with no loss of
  vector fidelity.
- **Table columns repeat on every tile** (not just the left-most column of
  pages, as MS Project itself sometimes does) — every page is
  self-identifying, at the cost of some repeated ink.
- **Cross-tile dependency arrows are dropped, not stubbed** with an
  off-page indicator arrow. Simpler, and consistent with the "best effort"
  framing already in the code this replaced.

## Next steps for Tim
1. Open a project's Programme tab → click the **Printer** button (now
   titled "Export PDF") → confirm a PDF downloads with correct tiling,
   bars, and legend for a real project's schedule (try one long enough to
   span multiple date-band pages, and one with 30+ tasks to span multiple
   row-band pages).
2. Once confirmed, say "push" to push `main` (this also covers phases 3 and
   4, still pending from their own handovers).
3. Then green-light Phase 6 (optional engine hardening — Fable only, not
   yet committed to).

## Where things stand in the 6-phase plan
- ✅ Phase 1 — done, committed `35c6e06`.
- ✅ Phase 2 — done, committed `fec9921`.
- ✅ Phase 3 — done, committed `e29a4e8`. Still pending Tim's function
  redeploy + verification + push.
- ✅ Phase 4 — done, committed `da23543`. Still pending Tim's migration run
  + function deploy + verification + push.
- ✅ Phase 5 — done (this handover), pending Tim's verification + push.
- ⬜ Phase 6 (optional) — engine hardening. Not committed to.
