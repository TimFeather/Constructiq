import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Drop-in replacement for base44.functions.invoke(name, payload)
export async function invokeFunction(name, payload = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body: payload });
  if (error) {
    // Try to extract the real error message from the function's JSON response body
    try {
      const body = await error.context?.json?.();
      if (body?.error) throw new Error(body.error);
    } catch (inner) {
      if (inner?.message && inner.message !== error.message) throw inner;
    }
    throw error;
  }
  return { data };
}

const ALLOWED_UPLOAD_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'zip', 'csv', 'ppt', 'pptx'];
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

// Buckets whose contents are NOT publicly readable. Uploads to these buckets return a
// storage PATH (not a URL) — the file must be rendered via a signed URL generated at
// view time with getSignedUrl()/getSignedUrls() (see <SecureFileLink>). Public buckets
// (e.g. 'Documents') keep returning a permanent public URL as before.
const PRIVATE_BUCKETS = new Set(['project-files']);

export function isPrivateBucket(bucket) {
  return PRIVATE_BUCKETS.has(bucket);
}

// True when a stored file_url value is already a usable URL (a permanent public URL or
// an existing signed URL) rather than a bare storage path that still needs signing.
// Lets components/migrations treat legacy public URLs and new private paths uniformly.
export function isStoredUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

// Drop-in replacement for base44.integrations.Core.UploadFile({ file })
// onProgress(pct: 0–100) is optional — called during upload if the browser supports it
// signal is an optional AbortSignal — passed through to the storage client for true
// network-level cancellation where the installed supabase-js supports it. Callers that
// need guaranteed cancel semantics should ALSO guard the post-upload DB write (and clean
// up via removeFile) since older clients may ignore the signal.
//
// Returns { file_url, bucket, path }:
//   • public bucket  → file_url is a permanent public URL
//   • private bucket → file_url is the storage path (sign it at view time)
// Callers that only need the stored value can continue to destructure { file_url }.
export async function uploadFile(file, bucket = 'Documents', onProgress = null, signal = null) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.includes(ext)) {
    throw new Error(`File type .${ext} is not allowed. Accepted: ${ALLOWED_UPLOAD_EXTS.join(', ')}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds 500 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  }
  const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const options = {};
  if (onProgress) options.onUploadProgress = ({ loaded, total }) => onProgress(Math.round((loaded / total) * 100));
  if (signal) options.signal = signal;
  const { error } = await supabase.storage.from(bucket).upload(path, file, Object.keys(options).length ? options : undefined);
  if (error) {
    const msg = error.message || String(error);
    if (msg.includes('exceeded') || msg.includes('too large') || msg.includes('413')) {
      throw new Error(`File is too large to upload. Please reduce the file size and try again, or contact your administrator.`);
    }
    throw error;
  }
  // Private buckets have no public URL — return the path so it can be signed on demand.
  if (PRIVATE_BUCKETS.has(bucket)) {
    return { file_url: path, bucket, path };
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { file_url: data.publicUrl, bucket, path };
}

// Best-effort cleanup of a just-uploaded file. Use this to roll back the storage write
// when the database row that should reference it fails to insert/update (prevents orphaned
// files). `bucket` and `path` are the values returned by uploadFile(). This NEVER throws —
// a failed cleanup must not mask the original error that triggered the rollback.
export async function removeFile(bucket, path) {
  if (!bucket || !path) return;
  try {
    await supabase.storage.from(bucket).remove([path]);
  } catch (e) {
    console.warn('[removeFile] cleanup failed', bucket, path, e?.message || e);
  }
}

// Generate a short-lived signed URL for a single private-bucket file.
// `path` is the storage path returned by uploadFile() (e.g. "1719…-abc.pdf").
// expiresIn is in SECONDS (default 1 hour). Returns null for an empty path.
export async function getSignedUrl(bucket, path, expiresIn = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

// Batch version of getSignedUrl — signs many paths in a single round-trip.
// Returns a Map of path → signedUrl (value is null for any path that failed to sign).
// Empty/falsy paths are skipped.
export async function getSignedUrls(bucket, paths, expiresIn = 3600) {
  const clean = (paths || []).filter(Boolean);
  if (clean.length === 0) return new Map();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(clean, expiresIn);
  if (error) throw error;
  const map = new Map();
  for (const item of data || []) {
    map.set(item.path, item.error ? null : item.signedUrl);
  }
  return map;
}

// Drop-in replacement for base44.integrations.Core.SendEmail(...)
export async function sendEmail({ to, toName, subject, body, htmlBody }) {
  return invokeFunction('sendEmail', { to, toName, subject, htmlBody: htmlBody || body });
}
