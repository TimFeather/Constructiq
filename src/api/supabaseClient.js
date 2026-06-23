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

// Drop-in replacement for base44.integrations.Core.UploadFile({ file })
// onProgress(pct: 0–100) is optional — called during upload if the browser supports it
export async function uploadFile(file, bucket = 'Documents', onProgress = null) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.includes(ext)) {
    throw new Error(`File type .${ext} is not allowed. Accepted: ${ALLOWED_UPLOAD_EXTS.join(', ')}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds 500 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  }
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const options = onProgress
    ? { onUploadProgress: ({ loaded, total }) => onProgress(Math.round((loaded / total) * 100)) }
    : undefined;
  const { error } = await supabase.storage.from(bucket).upload(path, file, options);
  if (error) {
    const msg = error.message || String(error);
    if (msg.includes('exceeded') || msg.includes('too large') || msg.includes('413')) {
      throw new Error(`File is too large to upload. Please reduce the file size and try again, or contact your administrator.`);
    }
    throw error;
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { file_url: data.publicUrl };
}

// Drop-in replacement for base44.integrations.Core.SendEmail(...)
export async function sendEmail({ to, toName, subject, body, htmlBody }) {
  return invokeFunction('sendEmail', { to, toName, subject, htmlBody: htmlBody || body });
}
