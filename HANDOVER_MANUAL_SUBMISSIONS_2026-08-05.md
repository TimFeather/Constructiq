# Handover — Record subcontractor pricing received outside ConstructIQ

Implements [PLAN_MANUAL_SUBMISSIONS_2026-08-05.md](PLAN_MANUAL_SUBMISSIONS_2026-08-05.md). All 4 phases done, `npm test` green (196/196).

## What you need to do

1. **Run the migration** — `supabase/migrations/026_manual_submissions.sql` in the Supabase SQL Editor. Adds 5 provenance columns to `tender_submissions` (no new table, no new grants). Run the 3 verification queries at the bottom of the file after applying.
2. **Deploy the edge function**:
   ```bash
   supabase functions deploy recordSubmission
   ```
3. Nothing else to deploy — Phase 3 is client-only (already built by Vite on your next `npm run build`/deploy).

## What changed

| File | What |
|---|---|
| `supabase/migrations/026_manual_submissions.sql` | New — provenance columns (`submission_source`, `recorded_by_email/name`, `recorded_at`, `received_after_close`) |
| `supabase/functions/recordSubmission/index.ts` | New — admin/pricing-only edge function: `upload`, `save`, `removeFile` |
| `src/lib/manualSubmission.js` | New — pure payload/validation/date logic, unit-tested |
| `src/lib/__tests__/manualSubmission.test.js` | New — 16 tests |
| `src/components/tenders/RecordSubmissionDialog.jsx` | New — the dialog UI |
| `src/components/tenders/SubmissionScorer.jsx` | Edited — "Record submission" button, manual/after-close badges, "Entered by" line, "Edit submission" button |

Nothing else touched — the portal (`tenderPublicApi`), `getSubmissionFileUrl`, `OutcomePanel`, and the scoring maths are all unchanged.

## Verification checklist (re-read against `recordSubmission/index.ts`)

- [x] Role gate is `admin`/`pricing` only, checked before any write — `index.ts:47-48`
- [x] `inviteeId` verified to belong to `tenderId` (no cross-tender writes) — `index.ts:121`
- [x] `removeFile` refuses a path not referenced by that submission — `index.ts:338-341`
- [x] Every file row carries `storage_path` — set on `upload` response and threaded through `save`'s `files` input
- [x] No second submission row can be created for one invitee — dedupe order: `submissionId` → existing `invitation_id` → `(tender_id, invitee_id)`, `index.ts:189-201`
- [x] `scores` / `outcome*` untouched on edit — `rowValues` (the object written on both insert and update) never sets those keys
- [x] Upload rollback on DB failure — `rollbackFiles()` called on submission-not-found (`:192`), update failure (`:223`), insert failure (`:235`)
- [x] No query error silently discarded — `tender_invitations`/`tender_invitees`/`tender_activity`/`audit_logs`/`removeFile` writes all check `.error` and `console.error` it (`index.ts:247,253,267,285,355,360`)

## Manual test script

Run this after applying the migration and deploying the function.

1. Open a **closed** tender → Submissions tab → **Record submission**. Pick an invitee who never submitted. Enter $12,500, attach a PDF, leave the email checkbox off. Save.
2. The card appears in the right trade group with **Recorded manually** + **After close** badges, priced $12,500. Open **View/Score** → the PDF downloads under its real filename.
3. Invitees tab: that invitee now shows **Submitted**.
4. Activity tab: one "Pricing recorded on behalf of …" line.
5. Re-open **Edit submission**, change the price to $13,000, add a second file, save → still one row, updated price, two files, a second activity line showing 12,500 → 13,000.
6. Repeat step 1 on an **open** tender with a sub who is *not* an invitee, using "+ Someone not on the invitee list", and tick the confirmation email checkbox → the sub appears as an invitee and receives the standard "Submission Received" email.
7. Confirm the subcontractor portal is **unchanged**: a closed tender's invite link still refuses submissions (400 "no longer accepting submissions").

## Out of scope (flagged in the plan, not built)

- **Deleting a submission** — no UI, no file cleanup path (`garbageCollectFiles` doesn't cover the `tender-submissions` bucket). Separate job if you want it.
- **Possible latent bug, found while planning, not touched here:** `tender_invitations.status` has a check constraint of `('Sent','Viewed','Submitted')`, but `tenderPublicApi`'s `updateIntent` action writes `'Declined'` and discards the error (`tenderPublicApi/index.ts:622-626`). If the live DB still matches `schema.sql`, "Will not tender" never sticks on the invitation row — which would also mean `issueNTT`'s `.neq('status','Declined')` filter never excludes anyone, so declined subs may still get NTT emails. **Needs verifying against the live DB** (schema.sql and production can drift) before deciding whether it's real. Worth a look separately.
