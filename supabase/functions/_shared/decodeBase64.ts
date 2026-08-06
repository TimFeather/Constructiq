/**
 * Base64 decoding for edge functions that accept file uploads as JSON.
 *
 * The obvious form — `Uint8Array.from(atob(b64), c => c.charCodeAt(0))` — runs one
 * JS callback per byte through the iterator protocol. On anything past a few MB it
 * exhausts the isolate's CPU budget and Supabase kills the worker mid-request, which
 * surfaces to the browser as HTTP 546 (resource limit exceeded) with no error body:
 * https://supabase.com/docs/guides/troubleshooting/edge-function-546-error-response
 *
 * fetch() on a data: URL decodes natively (no per-byte JS), so it is the fast path.
 * The manual loop is a fallback and is still far cheaper than the mapper form.
 */

/** Byte length of the decoded payload, computed from the string — no decode needed. */
export function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export async function decodeBase64(b64: string): Promise<Uint8Array> {
  try {
    const res = await fetch(`data:application/octet-stream;base64,${b64}`);
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    console.warn('[decodeBase64] data-URL decode failed, falling back to loop:', (e as Error)?.message);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
}
