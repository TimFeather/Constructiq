# Handover: CPM sub-day task packing fix

Full brief (context, approach, watch-outs, verification bar, Tim's workflow rules):
`~/.claude/plans/plan-the-bug-fix-smooth-pudding.md` — read it first.

One-line summary: the CPM engine in `src/lib/scheduling/criticalPath.js` is day-granular,
so chains of sub-day (4h) tasks drift later than MS Project, which packs them into shared
calendar days. Make the forward/backward pass hour-granular while all consumers keep
receiving day-granular `yyyy-MM-dd` strings. Verify against Tim's real export
(`9 Barker rd program REV.3.xml` in his OneDrive Downloads): exact-match count must rise
well above 62/221, with every remaining mismatch class explained.

Branch: `programme-engine` (do NOT push without an explicit "push" from Tim).
Baseline: commit `0305cb7`, 77 tests / lint / build all green.
