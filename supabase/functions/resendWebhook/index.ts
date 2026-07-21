/**
 * resendWebhook
 *
 * Receives Resend delivery events (sent, delivered, bounced, complained,
 * opened, clicked, failed, delayed) and records them against email_messages
 * / email_events.
 *
 * Deploy WITHOUT JWT verification — Resend has no Supabase session:
 *   supabase functions deploy resendWebhook --no-verify-jwt
 *
 * Auth is instead the Svix signature on every request, using the signing
 * secret Resend shows when you create the webhook endpoint:
 *   supabase secrets set RESEND_WEBHOOK_SECRET=whsec_...
 *
 * The endpoint fails closed: with no secret configured it rejects everything,
 * because an unauthenticated writer could otherwise forge "delivered" events
 * for mail that never arrived.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Rank guards against out-of-order webhook delivery: a late 'sent' must not
// overwrite an already-recorded 'bounced'. Failure states rank highest so a
// complaint or bounce sticks even if an open/click arrives afterwards.
const EVENT_STATUS: Record<string, { status: string; rank: number }> = {
  'email.scheduled':        { status: 'scheduled',  rank: 10 },
  'email.sent':             { status: 'sent',       rank: 20 },
  'email.delivery_delayed': { status: 'delayed',    rank: 30 },
  'email.delivered':        { status: 'delivered',  rank: 40 },
  'email.opened':           { status: 'opened',     rank: 50 },
  'email.clicked':          { status: 'clicked',    rank: 60 },
  'email.complained':       { status: 'complained', rank: 90 },
  'email.bounced':          { status: 'bounced',    rank: 95 },
  'email.failed':           { status: 'failed',     rank: 95 },
};

const TOLERANCE_SECONDS = 5 * 60;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Decodes the signing secret to key bytes.
 *
 * Secrets get mangled in transit more often than you'd think: copied with
 * surrounding quotes, a trailing newline from a shell heredoc, or emitted
 * base64url (`-_`) rather than standard base64 (`+/`). Normalise all of
 * those rather than letting atob throw an opaque "Failed to decode base64".
 */
function decodeSecret(secret: string): Uint8Array {
  let raw = secret.trim().replace(/^["']|["']$/g, '');
  if (raw.startsWith('whsec_')) raw = raw.slice(6);
  raw = raw.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (raw.length % 4 !== 0) raw += '='.repeat(4 - (raw.length % 4));
  return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
}

/**
 * Svix signature scheme (what Resend uses):
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = base64(HMAC-SHA256(base64decode(secret minus whsec_ prefix), content))
 * The svix-signature header carries a space-separated list of `v1,<sig>`
 * so a secret can be rotated without downtime — any match is valid.
 */
async function verifySignature(
  secret: string, svixId: string, svixTimestamp: string, svixSignature: string, body: string,
): Promise<boolean> {
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeSecret(secret);
  } catch {
    // Config error, not a forged request. Say so loudly in the logs, but
    // still reject rather than 500 — a 500 makes Svix retry a request that
    // can never succeed until the secret is fixed.
    console.error(
      `[resendWebhook] RESEND_WEBHOOK_SECRET is not valid base64 ` +
      `(length=${secret.trim().length}, whsec_prefix=${secret.trim().startsWith('whsec_')}). ` +
      `Re-copy the signing secret from the Resend webhook page.`,
    );
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );

  const signed   = `${svixId}.${svixTimestamp}.${body}`;
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  return svixSignature
    .split(' ')
    .map((part) => part.split(',')[1])
    .filter(Boolean)
    .some((provided) => constantTimeEqual(provided, expected));
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    if (!WEBHOOK_SECRET) {
      console.error('[resendWebhook] RESEND_WEBHOOK_SECRET is not set — rejecting');
      return Response.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // Must read the body as raw text: re-serialising JSON would change the
    // bytes and break the signature.
    const rawBody       = await req.text();
    const svixId        = req.headers.get('svix-id') ?? '';
    const svixTimestamp = req.headers.get('svix-timestamp') ?? '';
    const svixSignature = req.headers.get('svix-signature') ?? '';

    if (!svixId || !svixTimestamp || !svixSignature) {
      return Response.json({ error: 'Missing signature headers' }, { status: 401 });
    }

    const valid = await verifySignature(WEBHOOK_SECRET, svixId, svixTimestamp, svixSignature, rawBody);
    if (!valid) {
      console.warn(`[resendWebhook] Invalid signature svix-id=${svixId}`);
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = JSON.parse(rawBody);
    const type  = event?.type as string;
    const data  = event?.data ?? {};
    const resendId = data.email_id ?? data.id ?? null;

    if (!resendId) {
      console.warn(`[resendWebhook] Event ${type} carried no email id — ignoring`);
      return Response.json({ ok: true, ignored: 'no email id' });
    }

    const mapped = EVENT_STATUS[type];
    if (!mapped) {
      console.log(`[resendWebhook] Unmapped event type ${type} — logging only`);
    }

    const recipient  = Array.isArray(data.to) ? data.to[0] : data.to ?? null;
    const occurredAt = event.created_at ?? data.created_at ?? new Date().toISOString();
    const bounce     = data.bounce ?? null;

    // ── Find or create the message row ────────────────────────────────────
    // The send path pre-registers a row with tender/invitee context. Emails
    // sent outside that path (or before this feature shipped) get created
    // here so nothing is invisible — just without context links.
    const { data: existing } = await supabaseAdmin
      .from('email_messages')
      .select('id, status_rank')
      .eq('resend_id', resendId)
      .maybeSingle();

    let messageId = existing?.id ?? null;

    if (!messageId) {
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('email_messages')
        .insert({
          resend_id: resendId,
          recipient: recipient ?? 'unknown',
          subject:   data.subject ?? null,
          status:    mapped?.status ?? 'queued',
          status_rank: mapped?.rank ?? 0,
          error_type:    bounce?.type ?? null,
          error_subtype: bounce?.subType ?? null,
          error_message: bounce?.message ?? null,
          last_event_at: occurredAt,
        })
        .select('id')
        .single();

      if (insertErr) throw insertErr;
      messageId = inserted.id;
    } else if (mapped && mapped.rank >= (existing.status_rank ?? 0)) {
      const patch: Record<string, unknown> = {
        status:        mapped.status,
        status_rank:   mapped.rank,
        last_event_at: occurredAt,
        updated_at:    new Date().toISOString(),
      };
      // Only stamp failure detail on failure events, so a later delivered/
      // opened event doesn't inherit a stale bounce reason.
      if (bounce) {
        patch.error_type    = bounce.type ?? null;
        patch.error_subtype = bounce.subType ?? null;
        patch.error_message = bounce.message ?? null;
      }
      if (recipient) patch.recipient = recipient;
      if (data.subject) patch.subject = data.subject;

      const { error: updateErr } = await supabaseAdmin
        .from('email_messages').update(patch).eq('id', messageId);
      if (updateErr) throw updateErr;
    }

    // ── Append the raw event ──────────────────────────────────────────────
    // svix_id is unique, so Svix's at-least-once retries collapse to one row.
    const { error: eventErr } = await supabaseAdmin
      .from('email_events')
      .insert({
        message_id:  messageId,
        resend_id:   resendId,
        svix_id:     svixId,
        event_type:  type,
        occurred_at: occurredAt,
        payload:     event,
      });

    // 23505 = duplicate svix_id, i.e. a replay. Expected, not an error.
    if (eventErr && eventErr.code !== '23505') throw eventErr;

    console.log(`[resendWebhook] ${type} recorded for ${recipient} (${resendId})`);
    return Response.json({ ok: true });
  } catch (error: any) {
    console.error('[resendWebhook] ERROR:', error?.message);
    // 500 makes Svix retry, which is what we want for transient DB errors.
    return Response.json({ error: error?.message }, { status: 500 });
  }
});
