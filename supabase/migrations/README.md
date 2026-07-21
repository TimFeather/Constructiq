# Migrations

Numbered SQL files, applied **by hand** in the Supabase SQL Editor. There is
no automatic runner — a committed migration is not an applied migration, and
the two routinely drift. If a field "won't save" or a new panel is empty, check
whether its migration was actually run before debugging the code.

Files ending `.INSTRUCTIONS.md` are manual setup steps (secrets, dashboard
config, cron) that cannot live in SQL. Run them alongside their migration.

Edge functions deploy separately and are equally manual:

```
supabase functions deploy <name>
```

`--no-verify-jwt` for anything called by an outside service rather than a
signed-in user (e.g. `resendWebhook`, which Resend calls).

---

## The one rule that keeps biting: GRANT

**This database has no permissive default privileges on `public`.** Creating a
table with RLS policies is *not enough*. Without an explicit `grant`, every
request fails with:

```
42501 permission denied for table <name>
```

...*before RLS is even evaluated*. The feature looks fully deployed and errors
on every read.

This has now cost three follow-up migrations:

| Missed grants in | Fixed by | Symptom |
|---|---|---|
| 006 (programme tables) | 007 | every programme request 403'd |
| 020 (email delivery) | 021 | Settings panel + invitee badge blank |
| — (reminder tables) | 023 | reminders silently never sent |

### Every new table needs both roles

```sql
-- What signed-in users may do; RLS then narrows it to the right rows.
grant select, insert, update, delete on public.<table> to authenticated;

-- Edge functions connect as service_role.
grant all on public.<table> to service_role;
```

Grant only what the table actually needs — a table written solely by edge
functions does not need `authenticated` write access, and a UI-only view does
not need `service_role`.

**`service_role` is not exempt.** `BYPASSRLS` skips row policies, not table
grants. An edge function reading an ungranted table gets `42501` like anyone
else — and if the calling code discards the error (see below) it fails silently.

### Two gotchas

- **`security_invoker` views read as the caller**, so the grant must exist on
  the *underlying tables*, not just the view.
- **`drop view` discards its grants.** Re-issue them in the same migration —
  see 022.

---

## Template

```sql
-- ============================================================
-- Migration NNN — <what and why>
-- Run in Supabase SQL Editor.
-- Safe to re-run.  [say so, and make it true, wherever possible]
-- ============================================================

create table if not exists public.<table> ( ... );

create index if not exists idx_<table>_<col> on public.<table>(<col>);

alter table public.<table> enable row level security;

create policy "<table>_select" on public.<table> for select using (
  get_my_role() in ('admin','pricing','internal')
);

grant select on public.<table> to authenticated;
grant all    on public.<table> to service_role;

-- ============================================================
-- Verification (run after applying):
--   <a query proving it worked, and what to expect>
-- ============================================================
```

Always include the verification block. It is the only feedback that a
hand-applied migration did what it claimed.

---

## Auditing what is already there

Lists anything in `public` that either role cannot read:

```sql
select
  case c.relkind when 'r' then 'table' when 'v' then 'view'
                 when 'm' then 'matview' end            as kind,
  c.relname                                             as name,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_read,
  has_table_privilege('service_role',  c.oid, 'SELECT') as service_role_can_read
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','v','m')
  and not (has_table_privilege('authenticated', c.oid, 'SELECT')
       and has_table_privilege('service_role',  c.oid, 'SELECT'))
order by c.relname;
```

Rows are not automatically bugs — check each against what actually reads the
table. Known-intentional as of 023: `takeoff_*` (orphaned by the TakeoffIQ
pivot, nothing reads them), `trade_templates` (client-only),
`tender_invitee_delivery` (UI view).

---

## Do not swallow query errors in edge functions

The reminder outage was a missing grant, but it went unnoticed for a different
reason — the caller threw the error away:

```ts
// Bad: a failed read is indistinguishable from an empty table.
const { data } = await supabaseAdmin.from('reminder_settings').select('*');
const settings = data || [];
```

`settings` became `[]`, every reminder was skipped by an `?.enabled` guard, and
the function returned success having sent nothing. Check the error and fail
loudly when the read is load-bearing:

```ts
const res = await supabaseAdmin.from('reminder_settings').select('*');
if (res.error) throw new Error(`Could not read reminder_settings: ${res.error.message}`);
```

"Nothing is configured" and "I cannot read the configuration" must not look the
same from outside.
