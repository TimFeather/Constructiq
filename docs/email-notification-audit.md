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

## Known gaps requiring follow-up

- **`rfi_response` recipient filtering** (`src/pages/RFIDetail.jsx`, `respondMutation`,
  ~lines 148-157): assignees/creator who are contacts without a ConstructIQ
  account are silently excluded from the notification (filtered against
  `registeredUsers`), and the `sendEmail` call itself still swallows failures
  via `.catch(() => {})`. Suggested approach: either (a) extend the RFI
  portal to support a token-based unauthenticated view similar to the tender
  portal so unregistered assignees can be emailed a working link, or (b) at
  minimum surface a toast when `notifyEmails` contains addresses that get
  filtered out, so the RFI owner knows some assignees weren't notified. Either
  requires a product decision, not just a bug fix.

- **`tender_question_posted` / `tender_question_answered` template drift**
  (`supabase/functions/tenderPublicApi/index.ts`, actions `createQuestion` /
  `respondQuestion` / admin-shortcut branch): these hand-build HTML instead of
  calling `resolveTemplate()` against the `email_templates` table, so
  Settings-page edits to those two templates have no effect on the emails
  actually sent. Suggested approach: load `email_templates` + `email_branding`
  in `tenderPublicApi` (same pattern already used in `sendTenderInvitations`
  and `issueNTT`) and render via the shared `replace()`/`buildWrapper()`
  helpers instead of inline template literals.

- **`contract_instruction` template unused** (`supabase/functions/invitationService/index.ts`,
  action `notifyCI`): sends a hardcoded inline email instead of resolving the
  `contract_instruction` DB template, even though that template is fully
  defined with matching variables (`ci_number`, `project_name`, `title`,
  `instruction_type`, `issue_date`, `description`, `url`, etc.) and exposed in
  the Settings template editor. Suggested approach: have `notifyCI` fetch
  `email_templates` filtered to `contract_instruction`, apply vars the same
  way `addExistingUser`'s `team_added` send already does in the same file, and
  fall back to the current inline HTML only if no custom template row exists.

- **`user_invite` and `team_invited` templates unused** (`supabase/functions/invitationService/index.ts`,
  `sendInvitationEmail()` helper, used by actions `invite`, `invitePlatform`,
  `resend`, and `bulkInviteProjectTeam`'s new-user branch): hardcodes its own
  HTML rather than resolving either template. Since `sendInvitationEmail()` is
  a single shared helper, fixing this in one place would cover both templates
  (in practice `user_invite` is the more appropriate one to use, since
  `team_invited` and `user_invite` largely overlap in purpose — worth deciding
  whether to consolidate to a single template key as part of the fix, which
  is a product decision beyond a trivial patch). Suggested approach: pass
  `emailTemplates`/`branding` into `sendInvitationEmail()` and prefer the DB
  template row when present.

- **Tender submission internal-notify recipient** (`supabase/functions/tenderPublicApi/index.ts`,
  action `submit`, ~line 504): only notifies `tender.created_by_email`, not
  `tender.tender_lead_email` (the internal reminder in `sendReminders`
  notifies both). If a tender is created by one person but "led" by another,
  the lead never hears about new submissions. Suggested approach: build a
  `Set` of `[tender.tender_lead_email, tender.created_by_email]` the same way
  `sendReminders`'s internal-reminder branch already does, and send to all of
  them.

- **`tender_outcome_unsuccessful` template unused** (`src/lib/emailTemplates.js`,
  `src/pages/Settings.jsx`): fully defined and editable in Settings, but no
  sender resolves this key — `sendOutcomeNotifications` only ever uses
  `tender_sub_awarded` / `tender_sub_unsuccessful`. Likely a naming leftover
  from an earlier template set. Suggested approach: either wire it in
  wherever an "unsuccessful — we lost the whole tender" internal notification
  should exist (no such internal notification currently exists at all), or
  remove the dead template + Settings entry if it's confirmed obsolete —
  either way this needs a product decision, not a blind fix.

All of the above are code-level observations only — none require a DB
migration to investigate further, but the `contract_instruction` /
`user_invite` / `team_invited` fixes would benefit from confirming with Tim
whether any of these three templates should be retired instead of wired up,
since two of the three heavily overlap in purpose.
