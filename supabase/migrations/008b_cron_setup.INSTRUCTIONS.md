# Reminder cron setup (run once in the Supabase SQL editor)

The `sendReminders` edge function was never scheduled — this is why no tender-closing
reminders fired. Paste the SQL below into the Supabase SQL editor, replacing the two
placeholders first. **Never commit the real service-role key to git.**

- `<PROJECT-REF>` — your project ref (the subdomain in your Supabase dashboard URL)
- `<SERVICE_ROLE_KEY>` — Settings → API → `service_role` secret

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 19:00 UTC ≈ 07:00 NZST / 08:00 NZDT
select cron.schedule(
  'send-reminders-daily',
  '0 19 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/sendReminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

## Verify

```sql
-- Job exists and is active:
select jobid, jobname, schedule, active from cron.job;

-- After the first scheduled run (or fire it manually — see below):
select status, return_message, start_time
from cron.job_run_details
order by start_time desc limit 5;

-- Reminders actually sent:
select * from public.reminder_log order by sent_at desc limit 20;
```

## Check reminder settings exist

`sendReminders` silently skips any reminder type whose settings row is missing or disabled:

```sql
select * from public.reminder_settings;
```

If empty, insert the defaults:

```sql
insert into public.reminder_settings (reminder_type, enabled, days_before)
values ('tender_external', true, 2),
       ('tender_internal', true, 1),
       ('rfi_reminder',    true, 1)
on conflict (reminder_type) do nothing;
```

## Fire a manual test run (optional)

Run the `net.http_post(...)` select from the cron body directly in the SQL editor (with the
same URL/key substituted). The function's JSON response (visible in the edge-function logs,
and in `net._http_response`) includes per-tender send/skip details after the WS3 code change
is deployed with `supabase functions deploy sendReminders`.

## Un-schedule / re-schedule

```sql
select cron.unschedule('send-reminders-daily');
```
