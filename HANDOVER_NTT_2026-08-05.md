# HANDOVER: Notices to Tenderers upgrade — 2026-08-05

Branch: `ntt-upgrade-2026-08-05` (not pushed). Implements `PLAN_NTT_2026-08-05.md` in full,
all 4 phases, no DB migration.

## Deploy this before testing

```bash
supabase functions deploy issueNTT tenderPublicApi
```

Both functions changed. `issueNTT` carries Phases 1, 2 and 4's new actions;
`tenderPublicApi` only Phase 1's `?tab=questions` link fix.

## Commits on this branch

1. `f837e1d` — Phase 1: email links land on the right portal tab
2. `12bbc80` — Phase 2: notice content in the email body
3. `78af8ef` — Phase 3+4: dialog layout fix, full edit/delete for drafts

## Caveats to know before testing

**Saved email template (Phase 2e).** If Settings → Emails shows **"Customised"** on
*Notice to Tenderers Issued*, the row already saved in `email_templates` keeps whatever
body was saved there — it will **not** pick up `{notice_description}`, `{notice_title}`,
`{attachments_list}` or `{attachment_count}` automatically. Paste the new default body from
`PLAN_NTT_2026-08-05.md` §2b into the Settings editor, or delete the saved row to fall back
to the new coded default.

**Draft numbering (Phase 4c).** `createNotice` still derives the next number as
`max(existing) + 1`. Delete NTT-003 and the next notice created will also be NTT-003.
Correct for a draft that was never issued, but will look odd if reported. Gap-preserving
numbering was deliberately not added — raise it separately if it matters.

**Storage not cleaned up on delete.** Deleting a draft removes the `tender_notices` and
`tender_notice_attachments` rows but not the underlying files in the public `Documents`
bucket — an attachment row can't tell "uploaded for this notice" apart from "an existing
tender document that was ticked", and deleting storage for the second case would destroy a
live tender document. See "Deliberate limitation" in the plan for the real fix
(a `uploaded_for_notice` column, migration 027) — not built here on purpose.

## Manual test script

1. NTTs tab → **Create NTT**. The dialog should be noticeably wider, with the title
   pinned at the top and Cancel/Save pinned at the bottom while the middle scrolls.
   Type a long multi-paragraph description and attach a PDF. Save Draft.
2. Edit the draft: change the description, remove the PDF, attach a different one, tick
   an existing tender document. Save → reopen → all three changes stuck.
3. Delete the draft → it disappears; nothing was emailed.
4. Create and **issue** a fresh NTT with a description and one attachment.
5. In the received email: the notice title and full description are readable **in the
   email**, the attachment is listed and its link opens, and *View Notice on the Tender
   Portal* lands **on the Correspondence tab** with the notice visible.
6. Repeat step 5 signed in as an invitee who has **already submitted** — the link must
   still reach the Correspondence tab, with a green "your pricing was submitted" banner,
   not the confirmation screen.
7. From that deep-linked page, open Update Submission and submit → the confirmation
   screen returns as normal.
8. Confirm the issued NTT can still only be **Archived** — no pencil, no trash.
9. (Optional) Trigger a "question answered" email and confirm its link also lands on the
   Questions tab (`?tab=questions`) — same fix, different email, mentioned in Phase 1c.

## Verification pass (Phase 5 checklist)

All confirmed by re-reading `issueNTT/index.ts` against the plan:

- [x] `updateNotice` and `deleteNotice` both refuse anything not `Draft` — `index.ts:440`, `:500` (409)
- [x] Every var value escaped except the deliberately-pre-built `attachments_list` — `index.ts:134-145`
- [x] `issueNotice` and `retryEmails` both go through `buildNoticeEmail` — `index.ts:310`, `:409`
- [x] The attachments read checks its error — `index.ts:281`, `:392`
- [x] The delete returns the raw Postgres error message — `index.ts:512`
- [x] Portal URLs carry `?tab=correspondence` — `index.ts:109` (used by both send paths)
- [x] Role gate still `admin`/`pricing` on every action — single check at `index.ts:168` before
      the action dispatch, applies to all of them

`npm test` — 196/196 passing after every phase.

## Latent bug noted, not fixed (out of scope, from the plan)

`issueNotice` excludes invitees with `tender_invitations.status = 'Declined'`, but
`schema.sql`'s check constraint only allows `('Sent','Viewed','Submitted')`, and
`tenderPublicApi`'s `updateIntent` writes `'Declined'` while discarding the error. If the
live DB matches `schema.sql`, "Will not tender" never sticks and declined subs get NTT
emails anyway. **Check the live constraint first** — schema.sql and production drift — then
raise as its own fix if confirmed. Not touched in this branch.
