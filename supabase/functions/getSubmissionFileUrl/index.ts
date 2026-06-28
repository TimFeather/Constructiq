/**
 * getSubmissionFileUrl — admin-authenticated signing for tender submission files.
 *
 * The 'tender-submissions' bucket is service_role-only, so the browser cannot
 * generate signed URLs for it directly. Stored signed URLs expire (~30 days max),
 * which breaks downloads when admins score/download submissions later. This
 * endpoint regenerates fresh, short-lived signed URLs on demand using the
 * service-role key.
 *
 * Auth:   user JWT, role must be 'admin' or 'pricing' (matches manage:tenders).
 * Input:  { submissionId }
 * Output: { files: [{ file_name, storage_path, signed_url }] }
 *
 * The set of files is derived server-side from the submission row — the caller
 * cannot request arbitrary storage paths. Legacy rows that were saved with an
 * (expired) signed URL but no storage_path are recovered by parsing the path
 * back out of the stored URL, so existing submissions are fixed too.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') || 'https://app.constructiq.co.nz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const BUCKET = 'tender-submissions';
const EXPIRY_SECONDS = 3600; // 1 hour — long enough for a scoring session, short enough to stay private

// Recover the storage path from a stored value. A bare path is returned as-is;
// a signed URL like ".../object/sign/tender-submissions/<path>?token=..." has the
// path extracted; a non-matching URL (e.g. an unrelated public URL) returns null.
function extractPath(value?: string): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value; // already a path
  const marker = `/${BUCKET}/`;
  const idx = value.indexOf(marker);
  if (idx === -1) return null;
  const rest = value.slice(idx + marker.length).split('?')[0];
  try { return decodeURIComponent(rest); } catch { return rest; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    const { data: { user: authUser } } = await supabaseAdmin.auth.getUser(jwt);
    if (!authUser) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

    const { data: profile } = await supabaseAdmin.from('users').select('role').eq('id', authUser.id).single();
    if (!['admin', 'pricing'].includes(profile?.role || '')) {
      return Response.json({ error: `Forbidden — role '${profile?.role}'` }, { status: 403, headers: corsHeaders });
    }

    const { submissionId } = await req.json();
    if (!submissionId) return Response.json({ error: 'submissionId is required' }, { status: 400, headers: corsHeaders });

    const { data: submission, error: subErr } = await supabaseAdmin
      .from('tender_submissions')
      .select('id, pricing_files, uploaded_file_url, uploaded_file_name')
      .eq('id', submissionId)
      .single();
    if (subErr || !submission) {
      return Response.json({ error: 'Submission not found' }, { status: 404, headers: corsHeaders });
    }

    // Derive the file list the same way the frontend does: prefer pricing_files,
    // fall back to the single legacy uploaded_file_url.
    const rawFiles: any[] = (submission.pricing_files?.length)
      ? submission.pricing_files
      : (submission.uploaded_file_url
          ? [{ file_url: submission.uploaded_file_url, file_name: submission.uploaded_file_name }]
          : []);

    const files = rawFiles.map((f, i) => ({
      file_name:    f.file_name || `File ${i + 1}`,
      storage_path: f.storage_path || extractPath(f.file_url),
      file_url:     f.file_url || '',
    }));

    // Batch-sign every resolvable path in one round-trip.
    const paths = [...new Set(files.map(f => f.storage_path).filter(Boolean))] as string[];
    const signedByPath = new Map<string, string | null>();
    if (paths.length) {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrls(paths, EXPIRY_SECONDS);
      if (signErr) {
        return Response.json({ error: `Failed to sign URLs: ${signErr.message}` }, { status: 500, headers: corsHeaders });
      }
      for (const item of signed || []) {
        signedByPath.set(item.path, item.error ? null : item.signedUrl);
      }
    }

    const result = files.map(f => ({
      file_name:    f.file_name,
      storage_path: f.storage_path,
      // Fresh signed URL when we could resolve a path; otherwise fall back to the
      // stored value (best-effort for legacy rows we couldn't recover a path from).
      signed_url:   (f.storage_path && signedByPath.get(f.storage_path)) || f.file_url || null,
    }));

    return Response.json({ files: result }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('[getSubmissionFileUrl] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});
