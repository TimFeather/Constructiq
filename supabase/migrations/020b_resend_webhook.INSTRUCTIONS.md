# 020b — Resend webhook setup

Manual steps to activate the email delivery log. Do them in this order;
the webhook rejects everything until step 3 is done.

## 1. Apply the migrations

Run **both**, in order, in the Supabase SQL Editor, then the verification
queries at the bottom of each:

1. `020_email_delivery_log.sql` — tables, RLS, view
2. `021_email_delivery_grants.sql` — base table grants

021 is not optional. Without it every read fails with
`42501 permission denied for table email_messages`, before RLS is even
evaluated — the Settings panel and the invitee badge both go blank.

## 2. Deploy the functions

```
supabase functions deploy resendWebhook --no-verify-jwt
supabase functions deploy sendTenderInvitations
supabase functions deploy resendInvitation
supabase functions deploy sendReminders
supabase functions deploy sendOutcomeNotifications
```

`--no-verify-jwt` on `resendWebhook` is required — Resend has no Supabase
session. The endpoint authenticates by Svix signature instead, and rejects
every request until the secret in step 3 is set.

## 3. Create the endpoint in Resend

Resend dashboard → **Webhooks** → **Add Endpoint**.

- **URL:** `https://<project-ref>.supabase.co/functions/v1/resendWebhook`
- **Events:** select all of —
  `email.sent`, `email.delivered`, `email.delivery_delayed`,
  `email.bounced`, `email.complained`, `email.opened`, `email.clicked`,
  `email.failed`

Resend shows a signing secret (`whsec_...`) once, on creation. Copy it, then:

```
supabase secrets set RESEND_WEBHOOK_SECRET=whsec_...
```

Setting a secret restarts the functions, so give it a few seconds before
testing.

## 4. Verify

Resend's webhook page has a **Send test event** button. After firing one:

```sql
select event_type, resend_id, created_at
from public.email_events
order by created_at desc
limit 5;
```

A row means signature verification passed. Nothing after ~30s → check the
function logs in the Supabase dashboard:

**Edge Functions → resendWebhook → Logs**

(there is no `supabase functions logs` subcommand in CLI 2.x — the
dashboard is the only place these surface)

- `RESEND_WEBHOOK_SECRET is not set` → step 3 didn't take
- `RESEND_WEBHOOK_SECRET is not valid base64` → the secret was mangled in
  copying. The log line reports its length and whether the `whsec_` prefix
  survived, without printing the value. Re-copy it from the Resend webhook
  page and re-run `supabase secrets set`.
- `Invalid signature` → right format, wrong secret. Usually means the
  endpoint was recreated in Resend (which issues a new secret) without
  updating the Supabase secret.
- 401 with no log line → deployed without `--no-verify-jwt`

You can smoke-test the endpoint without Resend at all — these must hold
before any real event will work:

```
URL=https://<project-ref>.supabase.co/functions/v1/resendWebhook
curl -i -X POST $URL -H 'Content-Type: application/json' -d '{}'
# expect 401 {"error":"Missing signature headers"}

curl -i -X POST $URL -H 'Content-Type: application/json' \
  -H 'svix-id: probe' -H "svix-timestamp: $(date +%s)" \
  -H 'svix-signature: v1,bm90cmVhbA==' -d '{}'
# expect 401 {"error":"Invalid signature"}   <- a 500 here means the
# stored secret is malformed, not that the request was rejected
```

Then send a real tender invitation and confirm the status badge appears
next to the invitee in the tender's Invitees list, and the row appears
under **Settings → Emails → Email Delivery Log**.

## Notes

- Opened/clicked tracking only records if it is enabled on the Resend
  domain. Delivery and bounce events always fire.
- Emails sent by functions not in step 2 (`sendEmail`, `issueNTT`,
  `notifyProgrammePublished`, `registerInvited`, `invitationService`,
  `tenderPublicApi`) still appear in the log — the webhook creates their
  rows on first event — but without tender/invitee links, so they show a
  status and recipient only.
- Events are deduplicated on the Svix delivery id, so Resend's
  at-least-once retries are safe.
