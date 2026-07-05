# Email Notification Audit — ConstructIQ

Date: 2026-07-05
Scope: every email template key, every sender call site (`resend.emails.send` in
`supabase/functions/`, `invokeFunction('sendEmail', ...)` and
`invokeFunction('invitationService', ...)` in `src/`), and whether each is
reachable, wired, and fails loudly or silently.

This audit is the final workstream in a batch that already fixed: tender
conversion archiving, `sendReminders` day-window + diagnostics, and
`team_added` server-side email + invite-reuse gap (all in `invitationService`
/ `sendReminders` / `ConvertToProjectModal.jsx`).

## Template keys (15 total, from `src/lib/emailTemplates.js` `DEFAULT_TEMPLATES`)

`rfi_assigned`, `rfi_response`, `team_added`, `team_invited`,
`tender_invitation`, `tender_question_posted`, `tender_question_answered`,
`tender_notice_issued`, `tender_reminder_external`, `tender_reminder_internal`,
`rfi_reminder`, `tender_outcome_unsuccessful`, `tender_sub_awarded`,
`tender_sub_unsuccessful`, `contract_instruction`, `user_invite`.

## Event → sender matrix

| Event | Template key | Sender path (file:function) | Recipients | Failure handling | Status |
|---|---|---|---|---|---|
| RFI assigned (new RFI) | `rfi_assigned` | `src/components/rfis/RFIFormDialog.jsx:createMutation` (client → `sendEmail`) | Each selected assignee | Was empty `.catch(() => {})` | **Fixed this session** — now `console.warn` + destructive toast per failed recipient |
| RFI assignees edited (added) | `rfi_assigned` | `src/components/rfis/RFIAssigneesDialog.jsx:saveMutation` (client → `sendEmail`) | Newly-added assignees only | `console.warn` + destructive toast (already present) | OK |
| RFI response posted | `rfi_response` | `src/pages/RFIDetail.jsx:respondMutation` (client → `sendEmail`) | RFI creator + assignees, **filtered to `registeredUsers` only** | `.catch(() => {})` — silently swallowed | **Gap** (see follow-ups — filtering out contact-only assignees is a behaviour change, not a trivial fix) |
| Tender invitation issued | `tender_invitation` | `supabase/functions/sendTenderInvitations/index.ts` | Each Draft/Pending `tender_invitees` row with email | Per-recipient try/catch; failures pushed to `errors[]` and returned to caller as `{sent, failed, errors}` | OK |
| Tender question posted (by invitee) | `tender_question_posted` | `supabase/functions/tenderPublicApi/index.ts` action `createQuestion` | `tender.tender_lead_email \|\| tender.created_by_email` | `catch (_e) { /* non-blocking */ }` around the whole email block | OK (admin notification is best-effort by design; question itself is always saved) |
| Tender question answered (admin replies via RFI thread) | `tender_question_answered` | `supabase/functions/tenderPublicApi/index.ts` action `respondQuestion` | `invitation.invitee_email` | `catch (_e) { /* non-blocking */ }` | OK |
| Tender question answered (admin shortcut, no token) | `tender_question_answered` (inline, not DB template) | `supabase/functions/tenderPublicApi/index.ts` action `respondQuestion` with `token === '__admin_reply__'` | `invitee_email` from payload | `catch (_e) { /* non-blocking */ }` | OK — but uses a hardcoded inline template rather than the DB `tender_question_answered` template (cosmetic drift only, subject/body match closely) |
| NTT (Notice to Tenderers) issued | `tender_notice_issued` | `supabase/functions/issueNTT/index.ts` action `issueNotice` | All active (non-Declined) invitees | Per-recipient try/catch; `sent`/`failed`/`failedRecipients` returned; audit log + tender activity feed record counts | OK |
| NTT retry failed emails | inline (not a template key) | `supabase/functions/issueNTT/index.ts` action `retryEmails` | Recipients passed in by caller | Per-recipient try/catch, counts returned | OK |
| Tender closing reminder (external) | `tender_reminder_external` | `supabase/functions/sendReminders/index.ts` | Invitees with status Sent/Viewed, within days-before window | Per-recipient try/catch; dedup via `reminder_log`; skip reasons recorded in `details[]` | OK (fixed earlier this session — day-window + diagnostics) |
| Tender closing reminder (internal) | `tender_reminder_internal` | `supabase/functions/sendReminders/index.ts` | admin/pricing users + tender lead + creator | Same as above | OK |
| RFI/questions deadline reminder | `rfi_reminder` | `supabase/functions/sendReminders/index.ts` | Invitees with status Sent/Viewed, within days-before window | Same as above | OK |
| Tender submission received (confirmation to invitee) | inline (not a template key) | `supabase/functions/tenderPublicApi/index.ts` action `submit` | `invitation.invitee_email` | `catch (_e) { /* non-blocking */ }` | OK — confirms submission was received |
| Tender submission received (internal notify) | inline (not a template key) | `supabase/functions/tenderPublicApi/index.ts` action `submit`, ~line 503-530 | `tender.created_by_email` | `catch (_e) { /* non-blocking */ }` | OK — **confirmed present**; only notifies `created_by_email`, not `tender_lead_email` (see follow-ups) |
| Tender outcome — awarded | `tender_sub_awarded` | `supabase/functions/sendOutcomeNotifications/index.ts` | `sub.invitee_email` for each submission with `outcome = Awarded` | Explicit try/catch; writes `outcome_notification_status`/`_error` to `tender_submissions`, logs to `tender_activity`, supports `retryFailedOnly` | OK — best failure handling in the codebase |
| Tender outcome — unsuccessful (sub not selected) | `tender_sub_unsuccessful` | `supabase/functions/sendOutcomeNotifications/index.ts` | Same as above, `outcome = Unsuccessful` | Same as above | OK |
| Tender outcome — unsuccessful (we lost, internal-facing copy) | `tender_outcome_unsuccessful` | **None** | — | — | **Gap — defined but unused.** Template + Settings.jsx UI entry exist; no sender resolves this key. Superseded in practice by `tender_sub_unsuccessful`. |
| Team member added (existing user) | `team_added` | `supabase/functions/invitationService/index.ts` action `addExistingUser` | New team member's email | try/catch around email block; sets `emailSent` flag returned to caller; caller (`TeamManager.jsx`/`ProjectSubcontractors.jsx`) toasts based on `emailSent` | OK (fixed earlier this session — server-side send + `emailSent` flag) |
| Team member added (new user, no account) | inline invite email (not `team_added`/`team_invited`) | `supabase/functions/invitationService/index.ts` action `invite` → `sendInvitationEmail()` | New member's email | `.catch()` logs an `audit_logs` "Email Failed" row; caller doesn't see per-send failure, only `isNewInvite`/`duplicateAssignment` | OK — failure is recorded server-side even though not surfaced live in the UI |
| Team invite (project invitation, dead path) | `team_invited` | **None** | — | — | **Gap — defined but unused.** Template + Settings.jsx UI entry exist; actual invite email in `sendInvitationEmail()` is a hardcoded inline template, not `team_invited`. |
| Bulk team invite (tender → project conversion) | inline (existing-user branch) / `sendInvitationEmail()` (new-user branch) | `supabase/functions/invitationService/index.ts` action `bulkInviteProjectTeam` | Each team member built from awarded submissions + key contacts | Per-recipient try/catch; `results[]` returned with per-email status (`notified`/`notify_failed`/`invited`/`invite_failed`); caller (`ConvertToProjectModal.jsx`) treats it fire-and-forget (`.catch(() => {})`) | OK for logging; UI never surfaces individual failures (acceptable — conversion itself always succeeds) |
| Contract Instruction issued | `contract_instruction` (defined) / inline (actually sent) | `supabase/functions/invitationService/index.ts` action `notifyCI`, called from `src/components/projects/ProjectCIPanel.jsx:handleIssue` | Project team members with role Subcontractor + email | Was empty `catch (_e) { /* non-blocking */ }` in `ProjectCIPanel.jsx`; `notifyCI` itself catches per-recipient and returns a `sent` count | **Fixed this session** in `ProjectCIPanel.jsx` — now checks `sent` vs. expected count and toasts on partial/total failure. **`contract_instruction` template itself remains unused** — `notifyCI` uses its own hardcoded HTML (see follow-ups) |
| User invited to ConstructIQ (platform-level) | `user_invite` (defined) / inline (actually sent) | `supabase/functions/invitationService/index.ts` action `invitePlatform` → `sendInvitationEmail()` | Invitee email | `.catch()` logs `audit_logs` "Email Failed"; `PeopleSettings.jsx` shows toast from mutation `onError`/`onSuccess` only for the initiating request, not send failure specifically | OK for UX; **`user_invite` template itself remains unused** — hardcoded inline template is used instead (see follow-ups) |
| Resend pending invitation | none (reuses invite email) | `supabase/functions/invitationService/index.ts` action `resend` / `supabase/functions/resendInvitation/index.ts` | Invitee email | `resendInvitation` awaits `resend.emails.send` directly (throws to caller on failure, surfaced via `PeopleSettings.jsx` `resendMutation.onError` toast) | OK |

## Verified findings for known-suspect areas

**1. Tender submission received — internal notify.**
Confirmed present in `supabase/functions/tenderPublicApi/index.ts`, action
`submit`, lines ~503-530. Sends to `tender.created_by_email` only (does not
also copy `tender.tender_lead_email` the way the internal reminder does in
`sendReminders`). Non-blocking `try/catch`.

**2. `tender_question_posted` / `tender_question_answered` — both directions confirmed wired.**
- Ask: `tenderPublicApi` action `createQuestion` (public/invitee-facing) sends
  to `tender.tender_lead_email || tender.created_by_email` using the
  `tender_question_posted` template variables inline (not `resolveTemplate`
  from a DB row — the HTML is hand-built to match the template's shape).
- Answer: `tenderPublicApi` action `respondQuestion` (authenticated
  admin/pricing) sends to `invitation.invitee_email`. There is also an
  "admin shortcut" branch (`token === '__admin_reply__'`) used from
  `TenderDetail.jsx`'s admin RFI thread UI that sends the same style of email
  directly by `invitee_email` from the payload, bypassing the invitation
  token lookup.
- Both directions actually send. Neither one calls `resolveTemplate()` — they
  hardcode near-identical HTML in the Deno function rather than the browser
  reading the DB-stored `email_templates` row. This means changes to the
  `tender_question_posted`/`tender_question_answered` templates in Settings do
  **not** affect these two sends (only the subject text loosely matches the
  default). This is real drift but a deeper fix (loading `email_templates`
  from the edge function and rendering via a shared template engine) is not a
  trivial patch — flagged as a follow-up.

**3. `rfi_response` (`src/pages/RFIDetail.jsx`) recipient list.**
Confirmed: `respondMutation` builds `notifyEmails` from
`rfi.created_by_email` + `rfi.assignees[].email` + `rfi.assigned_to_email`,
excluding the responder themself. It then **only emails addresses that also
appear in `registeredUsers` (the full `User.list()` result)** — see lines
148-157. An RFI assignee who is a contact without a ConstructIQ account (e.g.
an external architect added via `TenderContact` but never invited to
register) is silently skipped — no email, no toast, no log. The `.catch(() =>
{})` around the `invokeFunction('sendEmail', ...)` call is also a silent
swallow for actual send failures on top of that. Flagged as a follow-up
because removing the registered-user filter is a behaviour change beyond a
trivial fix (the RFI portal currently requires a login to view/respond, so
emailing an unregistered contact would send a dead-end link without a
companion "invite them" flow).

**4. Every `invokeFunction('sendEmail', ...)` wrapped in an empty/log-only catch — inventory.**

| File:line (before fix) | Status |
|---|---|
| `src/pages/RFIDetail.jsx:155` — `rfi_response` notify loop | Left as-is (swallow is secondary to the recipient-filtering gap above; see follow-ups) |
| `src/components/rfis/RFIFormDialog.jsx:113` — `rfi_assigned` on RFI create | **Fixed this session** — added `console.warn` + destructive toast, matching the pattern already used in `RFIAssigneesDialog.jsx` |
| `src/components/rfis/RFIAssigneesDialog.jsx:83` — `rfi_assigned` on assignee edit | Already had `console.warn` + toast — no change needed |

**5. `invokeFunction('invitationService', ...)` calls wrapped in empty/log-only catches — inventory.**

| File:line | Action | Status |
|---|---|---|
| `src/components/projects/TeamManager.jsx:301-306` (`removeMember`) | `cancelProjectInvite` | Left as-is — genuinely non-critical cleanup (invite cancellation on removal), correctly commented `/* non-critical */` |
| `src/components/projects/ProjectSubcontractors.jsx:158-163` (`removeSub`) | `cancelProjectInvite` | Left as-is — same as above |
| `src/components/tenders/ConvertToProjectModal.jsx:169-175` | `bulkInviteProjectTeam` | Left as-is — project creation must never be blocked by notification failures; `results[]` already gives per-email status server-side for later inspection via audit trail |
| `src/components/projects/ProjectCIPanel.jsx:90-101` (`handleIssue`) | `notifyCI` | **Fixed this session** — now inspects the returned `sent` count against the expected recipient count and shows a destructive toast on partial/total failure, plus `console.warn` on hard failure |

**6. `contract_instruction` and `user_invite` template keys — confirmed defined-but-unused.**
- `contract_instruction`: defined in `emailTemplates.js` and listed in
  `src/pages/Settings.jsx` template-editor list, but no sender ever calls
  `resolveTemplate(..., 'contract_instruction')`. The actual CI notification
  (`invitationService` action `notifyCI`) builds its own hardcoded HTML
  inline. A user editing this template in Settings has zero effect on the
  email actually sent.
- `user_invite`: same situation. `invitationService`'s `sendInvitationEmail()`
  helper (used by `invite`, `invitePlatform`, `resend`, and the new-user
  branch of `bulkInviteProjectTeam`) hardcodes its own HTML rather than
  resolving the `user_invite` template. Editing `user_invite` in Settings has
  no effect.
- `team_invited` (not explicitly asked for but discovered during this pass):
  same situation — defined, listed in Settings, never resolved by any sender.

None of these are silent failures in the sense of "email didn't send" — the
emails do send, just using different (hardcoded) copy than what an admin sees
and edits in the Settings template editor. This is a UX/consistency gap, not
a delivery gap.

## Inline fixes made this session

1. **`src/components/rfis/RFIFormDialog.jsx:113`** — `rfi_assigned` notify-on-create
   loop had an empty `.catch(() => {})`. Changed to log a `console.warn` and
   show a destructive toast per failed recipient, mirroring the existing
   pattern in `RFIAssigneesDialog.jsx`.
2. **`src/components/projects/ProjectCIPanel.jsx`** — `handleIssue`'s
   `notifyCI` call had an empty `catch (_e) { /* non-blocking */ }` and never
   checked the returned `sent` count. Added a `useToast` import/hook, and now:
   - toasts a destructive warning if `sent < subcontractors.length` (partial
     failure) using the count difference in the description
   - toasts a destructive warning and logs `console.warn` if the whole call
     throws

Both changes were verified with `npm run lint` (see below) — no new errors
introduced, output was clean (no findings) for the full repo.

## Follow-up fixes (2026-07-05, second pass)

All 6 items below were implemented per Tim's decisions. Summary:

1. **`rfi_response` recipient filtering** (`src/pages/RFIDetail.jsx`,
   `respondMutation`): kept the registered-users-only filter (unregistered
   contacts still can't be emailed a working link without a portal change),
   but now partitions `notifyEmails` into `registered`/`skipped`. Skipped
   recipients trigger a non-destructive toast naming them. Each registered
   send's `.catch(() => {})` was replaced with `console.warn` +
   destructive toast per failed recipient, matching `RFIAssigneesDialog.jsx`.
   The RFI response itself always saves regardless of email outcome.
   Verified live: response saved and the send failure logged via
   `console.warn` as expected.

2. **`contract_instruction` wired up** (`supabase/functions/invitationService/index.ts`
   action `notifyCI`, called from `src/components/projects/ProjectCIPanel.jsx`):
   `notifyCI` now fetches the `email_templates` row (falls back to the
   `DEFAULT_TEMPLATES.contract_instruction` shape if none exists) and
   substitutes `recipient_name, ci_number, project_name, title,
   instruction_type, issue_date, description, attachments_note, url,
   sender_name`. `ProjectCIPanel.jsx` now also passes `description`,
   `issueDate`, and `hasAttachments` in the payload. Settings edits to this
   template now take effect. **Needs deploy**: `invitationService`.

3. **`user_invite` wired up** (`supabase/functions/invitationService/index.ts`
   `sendInvitationEmail()`, shared by `invite`, `invitePlatform`, `resend`,
   `bulkInviteProjectTeam`'s new-user branch): now fetches the `user_invite`
   template row and uses it (vars `name, invited_by, project_context,
   invite_link`) when present; falls back to the existing hardcoded HTML
   exactly as before when no custom row exists — no behaviour change for the
   common case. **Needs deploy**: `invitationService`.

4. **`tender_question_posted` / `tender_question_answered` wired up + escaping fix**
   (`supabase/functions/tenderPublicApi/index.ts`, actions `createQuestion`,
   `respondQuestion` (token path), and the admin-shortcut `respondQuestion`
   branch): all three now fetch the relevant `email_templates` row and
   render via `buildWrapper()`/`replaceVars()` helpers (copied from
   `sendReminders/index.ts`), falling back to inline defaults matching
   `DEFAULT_TEMPLATES` when no row exists. This also fixes a latent
   HTML-injection bug in the token-path `respondQuestion` branch, which
   previously interpolated `invitee_name`, `rfiRow.subject`, and the answer
   `content` into the email HTML **unescaped** — all three are now passed
   through `escapeHtml`. **Needs deploy**: `tenderPublicApi`.

5. **Submission internal-notify now includes tender lead**
   (`supabase/functions/tenderPublicApi/index.ts` action `submit`): replaced
   the single `tender.created_by_email` recipient with a deduped
   `[tender.tender_lead_email, tender.created_by_email]` set, each sent
   inside its own try/catch so one failure doesn't skip the other. **Needs
   deploy**: `tenderPublicApi`.

6. **Retired `team_invited` and `tender_outcome_unsuccessful`**: removed both
   keys from `DEFAULT_TEMPLATES` and `TEMPLATE_VARIABLES` in
   `src/lib/emailTemplates.js`, and removed their entries from the
   `TEMPLATE_KEYS` list in `src/pages/Settings.jsx` (hardcoded there, not
   derived from `DEFAULT_TEMPLATES`). Verified live in Settings → Email
   Templates: neither "Project Invitation" nor "Tender Outcome —
   Unsuccessful (We Lost)" appear; the remaining 14 template editors still
   load. Confirmed zero remaining references outside `docs/` and the legacy
   `base44/` folder. **No DB migration written** — Tim can optionally run
   `delete from email_templates where template_key in ('team_invited',
   'tender_outcome_unsuccessful');` manually; harmless either way since no
   sender resolves those keys.

**Verification done:** `npm run lint` and `npm run build` both pass clean.
Client-side items (1, 6) verified live in the preview against production
Supabase logged in as tim@thshb.co.nz. Edge-function items (2–5) were
verified by re-reading the diff for fallback-path equivalence, but the
actual Deno functions have not run since they're not deployed yet.

**Still needs Tim:**
`supabase functions deploy invitationService tenderPublicApi`, then smoke-test:
issue a CI on a test project, ask + answer a tender question on a test
tender invitee row, and confirm a custom edit to the `contract_instruction`
template in Settings shows up in the received email.
