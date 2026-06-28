/**
 * migrateStorageToPrivate — one-time Phase 6 storage migration.
 *
 * Moves private file bytes that currently live in the PUBLIC 'Documents' bucket
 * into the PRIVATE 'project-files' bucket, then rewrites the stored file_url
 * values from full public URLs to bare storage paths (which the frontend signs
 * on demand via getSignedUrl / <SecureFileLink>).
 *
 * Scope — only the tables that hold genuinely private files:
 *   • documents               — file_url (scalar) + versions[].file_url
 *   • rfis                    — attachments[].url + responses[].attachments[].url
 *   • contract_instructions   — attachments[].file_url
 * Tender packages, NTT attachments and logos intentionally STAY public and are
 * not touched.
 *
 * Safety properties:
 *   • Non-destructive — copies bytes to project-files, NEVER deletes from
 *     Documents. The original public file keeps working until Phase 7 cleanup.
 *   • Idempotent — a value that is already a bare path (no http) is skipped, so
 *     the function can be re-run safely and resumed after a timeout.
 *   • DB is rewritten only AFTER the copy succeeds. If a copy fails the row is
 *     left pointing at the still-working public URL and the error is reported.
 *   • Per-file error isolation — one bad file does not abort the run.
 *
 * Auth:  user JWT, role must be 'admin'.
 * Input: { mode: 'dry-run' | 'execute', limit?: number }   (default mode dry-run, limit 500)
 * Output: detailed per-table report (see buildReport).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

// This is a temporary, admin-JWT-gated, one-time migration tool that has to be
// runnable from both localhost (dev) and the deployed app. Reflect the caller's
// Origin so the browser preflight passes in either environment. (Safe here: the
// function authenticates via a bearer JWT and sends no credentialed cookies.)
const APP_URL = Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz';
function corsFor(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allow = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? origin : APP_URL;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SOURCE_BUCKET = 'Documents';
const TARGET_BUCKET = 'project-files';
// Public URL marker for the source bucket. getPublicUrl() produces
// `${SUPABASE_URL}/storage/v1/object/public/Documents/<path>`.
const SOURCE_MARKER = `/public/${SOURCE_BUCKET}/`;

type Classification =
  | { kind: 'path'; value: string }        // already a bare project-files path — skip
  | { kind: 'source'; path: string }       // public Documents URL — migrate
  | { kind: 'external'; value: string }    // some other http URL (e.g. base44) — leave, report
  | { kind: 'empty' };                     // null/empty — nothing to do

// Decide what a stored file_url value is and, for source URLs, recover its path.
function classify(value: unknown): Classification {
  if (typeof value !== 'string' || value.trim() === '') return { kind: 'empty' };
  if (!/^https?:\/\//i.test(value)) return { kind: 'path', value }; // already a bare path
  const idx = value.indexOf(SOURCE_MARKER);
  if (idx === -1) return { kind: 'external', value };
  const rest = value.slice(idx + SOURCE_MARKER.length).split('?')[0];
  let path: string;
  try { path = decodeURIComponent(rest); } catch { path = rest; }
  return { kind: 'source', path };
}

// Counters accumulated per table during a scan/run.
function newStats() {
  return {
    rows_scanned: 0,
    files_total: 0,        // total file references seen
    to_migrate: 0,         // source (Documents) URLs found
    already_path: 0,       // already bare paths (previously migrated)
    external: 0,           // other http URLs left untouched
    empty: 0,
    migrated: 0,           // successfully copied + rewritten (execute mode)
    errors: [] as Array<{ id: string; path: string; error: string }>,
  };
}
type Stats = ReturnType<typeof newStats>;

// Copy one file's bytes Documents -> project-files (upsert so partial re-runs are safe).
// Returns null on success or an error message string on failure.
async function copyToPrivate(path: string): Promise<string | null> {
  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(SOURCE_BUCKET).download(path);
  if (dlErr || !blob) return `download failed: ${dlErr?.message || 'no data'}`;
  const { error: upErr } = await supabaseAdmin.storage
    .from(TARGET_BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type || undefined });
  if (upErr) return `upload failed: ${upErr.message}`;
  return null;
}

// A budget so we never blow the function wall-clock. Shared across all tables.
class Budget {
  remaining: number;
  exhausted = false;
  constructor(limit: number) { this.remaining = limit; }
  take(): boolean {
    if (this.remaining <= 0) { this.exhausted = true; return false; }
    this.remaining -= 1;
    return true;
  }
}

// Process a single string value (scalar). In execute mode, copies + reports.
// Returns the possibly-rewritten value and whether the row needs a DB write.
async function handleValue(
  value: unknown,
  id: string,
  stats: Stats,
  execute: boolean,
  budget: Budget,
): Promise<{ newValue: unknown; changed: boolean }> {
  const c = classify(value);
  stats.files_total += 1;
  if (c.kind === 'empty') { stats.empty += 1; return { newValue: value, changed: false }; }
  if (c.kind === 'path') { stats.already_path += 1; return { newValue: value, changed: false }; }
  if (c.kind === 'external') { stats.external += 1; return { newValue: value, changed: false }; }
  // kind === 'source'
  stats.to_migrate += 1;
  if (!execute) return { newValue: value, changed: false };
  if (!budget.take()) return { newValue: value, changed: false }; // out of budget this run
  const err = await copyToPrivate(c.path);
  if (err) {
    stats.errors.push({ id, path: c.path, error: err });
    return { newValue: value, changed: false }; // leave row on the working public URL
  }
  stats.migrated += 1;
  return { newValue: c.path, changed: true }; // rewrite to bare path
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt);
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    const { data: profile } = await supabaseAdmin.from('users').select('role').eq('id', authUser.id).single();
    if (profile?.role !== 'admin') {
      return Response.json({ error: `Forbidden — role '${profile?.role}' (admin required)` }, { status: 403, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'execute' ? 'execute' : 'dry-run';
    const execute = mode === 'execute';
    const limit = Number.isFinite(body.limit) ? Math.max(1, Math.min(2000, body.limit)) : 500;
    const budget = new Budget(execute ? limit : Number.MAX_SAFE_INTEGER);

    const docs = newStats();
    const rfis = newStats();
    const cis = newStats();

    // ── documents: file_url (scalar) + versions[].file_url ──────────────────
    {
      const { data, error } = await supabaseAdmin.from('documents').select('id, file_url, versions');
      if (error) throw new Error(`read documents: ${error.message}`);
      for (const row of data || []) {
        docs.rows_scanned += 1;
        let changed = false;
        const patch: Record<string, unknown> = {};

        const scalar = await handleValue(row.file_url, row.id, docs, execute, budget);
        if (scalar.changed) { patch.file_url = scalar.newValue; changed = true; }

        const versions = Array.isArray(row.versions) ? row.versions : null;
        if (versions) {
          let vChanged = false;
          for (const v of versions) {
            if (v && typeof v === 'object') {
              const r = await handleValue((v as any).file_url, row.id, docs, execute, budget);
              if (r.changed) { (v as any).file_url = r.newValue; vChanged = true; }
            }
          }
          if (vChanged) { patch.versions = versions; changed = true; }
        }

        if (execute && changed) {
          const { error: upErr } = await supabaseAdmin.from('documents').update(patch).eq('id', row.id);
          if (upErr) docs.errors.push({ id: row.id, path: '(db update)', error: upErr.message });
        }
      }
    }

    // ── rfis: attachments[].url + responses[].attachments[].url ─────────────
    {
      const { data, error } = await supabaseAdmin.from('rfis').select('id, attachments, responses');
      if (error) throw new Error(`read rfis: ${error.message}`);
      for (const row of data || []) {
        rfis.rows_scanned += 1;
        let changed = false;
        const patch: Record<string, unknown> = {};

        const attachments = Array.isArray(row.attachments) ? row.attachments : null;
        if (attachments) {
          let aChanged = false;
          for (const a of attachments) {
            if (a && typeof a === 'object') {
              const r = await handleValue((a as any).url, row.id, rfis, execute, budget);
              if (r.changed) { (a as any).url = r.newValue; aChanged = true; }
            }
          }
          if (aChanged) { patch.attachments = attachments; changed = true; }
        }

        const responses = Array.isArray(row.responses) ? row.responses : null;
        if (responses) {
          let rChanged = false;
          for (const resp of responses) {
            const ra = resp && typeof resp === 'object' && Array.isArray((resp as any).attachments)
              ? (resp as any).attachments : null;
            if (ra) {
              for (const a of ra) {
                if (a && typeof a === 'object') {
                  const r = await handleValue((a as any).url, row.id, rfis, execute, budget);
                  if (r.changed) { (a as any).url = r.newValue; rChanged = true; }
                }
              }
            }
          }
          if (rChanged) { patch.responses = responses; changed = true; }
        }

        if (execute && changed) {
          const { error: upErr } = await supabaseAdmin.from('rfis').update(patch).eq('id', row.id);
          if (upErr) rfis.errors.push({ id: row.id, path: '(db update)', error: upErr.message });
        }
      }
    }

    // ── contract_instructions: attachments[].file_url ───────────────────────
    {
      const { data, error } = await supabaseAdmin.from('contract_instructions').select('id, attachments');
      if (error) throw new Error(`read contract_instructions: ${error.message}`);
      for (const row of data || []) {
        cis.rows_scanned += 1;
        const attachments = Array.isArray(row.attachments) ? row.attachments : null;
        if (!attachments) continue;
        let aChanged = false;
        for (const a of attachments) {
          if (a && typeof a === 'object') {
            const r = await handleValue((a as any).file_url, row.id, cis, execute, budget);
            if (r.changed) { (a as any).file_url = r.newValue; aChanged = true; }
          }
        }
        if (execute && aChanged) {
          const { error: upErr } = await supabaseAdmin.from('contract_instructions')
            .update({ attachments }).eq('id', row.id);
          if (upErr) cis.errors.push({ id: row.id, path: '(db update)', error: upErr.message });
        }
      }
    }

    const totalToMigrate = docs.to_migrate + rfis.to_migrate + cis.to_migrate;
    const totalMigrated = docs.migrated + rfis.migrated + cis.migrated;
    const remaining = execute ? Math.max(0, totalToMigrate - totalMigrated) : totalToMigrate;

    return Response.json({
      mode,
      ok: true,
      summary: {
        total_to_migrate: totalToMigrate,
        total_migrated: totalMigrated,
        remaining,                      // >0 in execute means call again to finish
        budget_exhausted: budget.exhausted,
        total_errors: docs.errors.length + rfis.errors.length + cis.errors.length,
      },
      tables: { documents: docs, rfis, contract_instructions: cis },
    }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[migrateStorageToPrivate] ERROR:', error?.message);
    return Response.json({ error: error?.message || String(error) }, { status: 500, headers: corsHeaders });
  }
});
