# ConstructIQ

Construction project management app for THS: project programmes (Gantt scheduling engine with dependencies, calendars, critical path), tenders (invitations, submissions, Q&A, awards), RFIs, documents, and subcontractor management.

## Stack

- **Frontend:** Vite + React SPA (`react-router-dom`), Tailwind CSS + shadcn/ui components
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions in `supabase/functions/`)
- **Email:** Resend, with customizable templates (defaults in `src/lib/emailTemplates.js`, overrides stored in the `email_templates` table, editable in Settings)
- **Hosting:** Vercel

## Local development

```bash
npm install
npm run dev
```

Requires a `.env.local` with the Supabase project URL and anon key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

## Key directories

- `src/pages/` — route-level page components
- `src/components/` — domain-organized UI (programme, tenders, rfis, projects, documents, settings, shared, ui)
- `src/lib/scheduling/` — the programme scheduling engine (single source of truth; `src/lib/schedulingEngine.js` is a legacy re-export shim)
- `supabase/migrations/` — numbered SQL migrations, run manually in the Supabase SQL Editor
- `supabase/functions/` — Deno edge functions (email sending, tender workflow, cron reminders)

## Database changes

Migrations are applied manually: paste the SQL from `supabase/migrations/NNN_*.sql` into the Supabase SQL Editor. `supabase/schema.sql` mirrors the live schema as documentation.

## History

Originally built on the Base44 platform; fully migrated to Supabase in June 2026.
