/**
 * garbageCollectFiles — reclaim orphaned files in the private 'project-files' bucket.
 *
 * Over time, failed uploads (pre-rollback), replaced versions, and deleted document
 * rows can leave files in storage that no database row references. This job finds and
 * (optionally) removes them.
 *
 * SAFETY MODEL — this deletes storage objects, so it is deliberately conservative:
 *   • Dry-run by default. It only deletes when called with { mode: 'execute' }.
 *   • Age guard. Files newer than `olderThanDays` (default 7) are NEVER deleted, so an
 *     upload that is mid-flight or whose DB row is being written cannot be reaped.
 *   • Over-referencing. The "still referenced" set is built by regex-scanning the FULL
 *     serialized rows of every table that can hold a project-files path (documents,
 *     rfis, contract_instructions, tender_submissions). Because the path is a unique
 *     `<timestamp>-<random>.<ext>` string, a substring match cannot collide — and
 *     scanning whole rows means a path stored in an unexpected/forgotten JSON field is
 *     still treated as referenced. The bias is always toward KEEPING a file.
 *   • Per-file error isolation — one failed delete does not abort the run.
 *
 * Auth: admin user JWT, OR the service-role key (so a pg_cron / scheduled call works).
 * Input:  { mode?: 'dry-run' | 'execute', olderThanDays?: number }
 * Output: { mode, totalObjects, referencedCount, agedSkipped, orphanCount, deleted,
 *           bytesReclaimable, sample: string[], errors: string[] }
 *
 * Suggested schedule (after deploy): weekly, e.g.
 *   select cron.schedule('gc-project-files', '0 3 * * 0', $$
 *     select net.http_post(
 *       url := '<PROJECT_URL>/functions/v1/garbageCollectFiles',
 *       headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>',
 *                                     'Content-Type', 'application/json'),
 *       body := jsonb_build_object('mode', 'execute')
 *     ); $$);
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

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

const BUCKET = 'project-files';
// Tables that can store a project-files path (see migrateStorageToPrivate scope).
// Over-inclusive on purpose: scanning an unrelated table is harmless.
const REFERENCING_TABLES = ['documents', 'rfis', 'contract_instructions', 'tender_submissions'];
// Storage paths look like `<13-digit-ms>-<random-or-uuid>.<ext>`. Matches both the legacy
// Math.random() form and the newer crypto.randomUUID() form.
const PATH_RE = /\d{13}-[A-Za-z0-9-]+\.[A-Za-z0-9]+/g;

async function isAuthorized(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return false;
  if (token === SERVICE_ROLE_KEY) return true; // scheduled / service-role caller
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return false;
  const { data: profile } = await supabaseAdmin.from('users').select('role').eq('id', user.id).single();
  return profile?.role === 'admin';
}

// Collect every project-files path referenced by any row of the scanned tables.
async function buildReferencedSet(): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (const table of REFERENCING_TABLES) {
    let from = 0;
    const page = 1000;
    // Paginate so large tables don't blow memory in one query.
    while (true) {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('*')
        .range(from, from + page - 1);
      if (error) {
        // A missing/odd table must NOT silently shrink the referenced set — fail loud.
        throw new Error(`Failed scanning ${table}: ${error.message}`);
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        const blob = JSON.stringify(row);
        const matches = blob.match(PATH_RE);
        if (matches) for (const m of matches) referenced.add(m);
      }
      if (data.length < page) break;
      from += page;
    }
  }
  return referenced;
}

// List every object at the bucket root (paths are flat — no folders).
async function listAllObjects() {
  const objects: { name: string; created_at?: string; size?: number }[] = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).list('', {
      limit, offset, sortBy: { column: 'created_at', order: 'asc' },
    });
    if (error) throw new Error(`Storage list failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const o of data) {
      // list() returns folder placeholders with null id — skip those.
      if ((o as any).id == null) continue;
      objects.push({ name: o.name, created_at: (o as any).created_at, size: (o as any).metadata?.size });
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return objects;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!(await isAuthorized(req))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'execute' ? 'execute' : 'dry-run';
    const olderThanDays = Number.isFinite(body.olderThanDays) ? Math.max(1, body.olderThanDays) : 7;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    const referenced = await buildReferencedSet();
    const objects = await listAllObjects();

    let agedSkipped = 0;
    const orphans: { name: string; size?: number }[] = [];
    for (const obj of objects) {
      if (referenced.has(obj.name)) continue;            // still referenced — keep
      const created = obj.created_at ? Date.parse(obj.created_at) : 0;
      if (!created || created >= cutoff) { agedSkipped++; continue; } // too new — keep
      orphans.push({ name: obj.name, size: obj.size });
    }

    const bytesReclaimable = orphans.reduce((s, o) => s + (o.size || 0), 0);
    const errors: string[] = [];
    let deleted = 0;

    if (mode === 'execute' && orphans.length > 0) {
      // Delete in batches so one bad name doesn't abort the rest.
      for (let i = 0; i < orphans.length; i += 100) {
        const batch = orphans.slice(i, i + 100).map(o => o.name);
        const { error } = await supabaseAdmin.storage.from(BUCKET).remove(batch);
        if (error) errors.push(`Batch ${i / 100}: ${error.message}`);
        else deleted += batch.length;
      }
    }

    return Response.json({
      mode,
      olderThanDays,
      totalObjects: objects.length,
      referencedCount: referenced.size,
      agedSkipped,
      orphanCount: orphans.length,
      deleted,
      bytesReclaimable,
      sample: orphans.slice(0, 20).map(o => o.name),
      errors,
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('[garbageCollectFiles] ERROR:', error?.message);
    return Response.json({ error: error?.message || String(error) }, { status: 500, headers: corsHeaders });
  }
});
