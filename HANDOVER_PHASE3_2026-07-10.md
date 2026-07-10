# ConstructIQ — Phase 3 handover (2026-07-10)

Part of the 6-phase bug-fixes & upgrades plan (memory: `bug-fixes-upgrades-2026-07-10`).
Phase 3 is **committed locally**, **not pushed** — waiting for Tim's "push".

No DB migration in this phase.

## What got done

1. **Shared `<PersonAutocomplete>`** ([PersonAutocomplete.jsx](src/components/shared/PersonAutocomplete.jsx)):
   controlled text input + suggestion dropdown searching `tender_contacts`
   (optionally also active platform `users` via `includeUsers`). Parent owns
   the text value/onChange and receives the full matched record via `onSelect`
   — it decides how to map the fields onto its own form. This unifies the
   three previously-bespoke implementations:
   - **TeamManager.jsx** — was a hand-rolled email-field dropdown searching
     users+contacts. Replaced with `PersonAutocomplete` bound to the email
     field (`includeUsers`), keeping the existing `detectEmail`/email-status
     badge logic untouched.
   - **InviteeManager.jsx** — was a debounced name-field dropdown searching
     contacts only. Replaced with `PersonAutocomplete` bound to full name (no
     debounce needed — it's client-side filtering over an already-fetched
     react-query cache, same as TeamManager did with no debounce).
   - **ProjectSubcontractors.jsx** — previously had **no autocomplete at all**
     (plain text inputs only). Added `PersonAutocomplete` on Full Name
     (`includeUsers`), matching the pattern used elsewhere.

2. **Write-back to `tender_contacts`** so people added from a project also
   become searchable in InviteeManager (and vice versa):
   - New shared helper [`upsertTenderContact.ts`](supabase/functions/_shared/upsertTenderContact.ts),
     lifted from the existing upsert logic already used by
     `manageTenderInvitee` (match by email, else by name+business; update or
     insert). `manageTenderInvitee` itself was left untouched to avoid
     touching working tender code.
   - Wired into [`invitationService`](supabase/functions/invitationService/index.ts)'s
     `invite` and `addExistingUser` actions — both are called from
     TeamManager and ProjectSubcontractors whenever a team member/subcontractor
     is added. Fire-and-forget (`.catch(() => {})`), so a contacts-table hiccup
     never blocks the primary add/invite flow.
   - **Why server-side, not a client-side insert:** checked
     `supabase/schema.sql` — `tender_contacts` has RLS enabled with only
     `select`/`update`/`delete` policies, no `insert` policy, so a client-side
     insert would be silently rejected by Postgres. This resolves the open
     question noted in the phase-3 plan (`bug-fixes-upgrades-2026-07-10`
     memory, item 3c).

## Verified so far
- `npx eslint` on all touched files — 0 errors (3 pre-existing unrelated
  warnings only, none introduced by this change).
- `npx vite build` — succeeds, no new warnings.
- Edge function changes are Deno (not tsc-checkable locally, no `deno` CLI
  installed in this environment) — reviewed by hand; brace/paren-balanced.
- Not yet verified in browser (memory: no preview_* testing, Tim verifies
  manually) and not yet verified against the live Supabase edge function
  (needs redeploy).

## Next steps for Tim
1. Deploy the updated `invitationService` function (`supabase functions deploy
   invitationService`) — it now also upserts `tender_contacts` on
   invite/addExistingUser.
2. Verify in browser:
   - TeamManager / ProjectSubcontractors: typing a name/email should show a
     dropdown of matches from the shared contacts directory and (for
     TeamManager/ProjectSubcontractors) active users; selecting one should
     fill the rest of the form.
   - Add a brand-new subcontractor (no prior contact record) to a project,
     then check they show up as a suggestion when adding an invitee on a
     tender (InviteeManager) — confirms the write-back worked.
3. Once confirmed, say "push" to push `main`.
4. Then green-light Phase 4 (Programme publish/edit-lock + notification
   email — needs migration `012_programme_publish.sql`).

## Where things stand in the 6-phase plan
- ✅ Phase 1 — done, committed `35c6e06`.
- ✅ Phase 2 — done, committed `fec9921`.
- ✅ Phase 3 — done (this handover), pending Tim's function redeploy +
  verification + push.
- ⬜ Phase 4 — Programme publish/edit-lock + notification email. Not started.
- ⬜ Phase 5 — Printing engine rebuild. Not started. Fable/careful-Opus
  territory.
- ⬜ Phase 6 (optional) — engine hardening. Not committed to; Tim must
  green-light. Fable only.
