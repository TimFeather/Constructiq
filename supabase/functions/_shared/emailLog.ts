/**
 * emailLog
 *
 * Records every outbound email in email_messages so resendWebhook has a row
 * to attach delivery events to — carrying the tender / invitee context the
 * webhook payload has no way of knowing.
 *
 * Two entry points:
 *   sendTrackedEmail — send via Resend and log the attempt (most call sites)
 *   logEmailSend     — log only, for call sites that already handle the
 *                      Resend result themselves (sendOutcomeNotifications)
 *
 * sendTrackedEmail also closes a silent-failure gap: the Resend SDK reports
 * API-level errors on `result.error` rather than throwing, so a bare
 * `await resend.emails.send(...)` swallows rejected sends. It throws on them,
 * letting the existing try/catch at each call site count the failure as it
 * already does for network errors.
 */

export interface EmailContext {
  kind?: string;              // 'tender_invitation', 'reminder', 'outcome', ...
  tenderId?: string | null;
  inviteeId?: string | null;
  projectId?: string | null;
  sentBy?: string | null;
}

export interface LogArgs {
  resendId: string | null;
  recipient: string;
  subject?: string | null;
  failure?: string | null;    // null when the send succeeded
  context?: EmailContext;
}

/**
 * Writes the email_messages row. Never throws — logging must not take down a
 * send that otherwise succeeded.
 */
export async function logEmailSend(supabaseAdmin: any, args: LogArgs): Promise<void> {
  const { resendId, recipient, subject = null, failure = null, context = {} } = args;

  try {
    const { error } = await supabaseAdmin.from('email_messages').insert({
      resend_id:     resendId,
      recipient,
      subject,
      kind:          context.kind ?? null,
      status:        failure ? 'failed' : 'sent',
      status_rank:   failure ? 95 : 20,
      tender_id:     context.tenderId ?? null,
      invitee_id:    context.inviteeId ?? null,
      project_id:    context.projectId ?? null,
      sent_by:       context.sentBy ?? null,
      error_message: failure,
      last_event_at: new Date().toISOString(),
    });

    // 23505 = the webhook already created this row (delivery events can beat
    // our insert). Attach the context it couldn't know; leave status alone,
    // since whatever the webhook recorded is newer than 'sent'.
    if (error?.code === '23505' && resendId) {
      await supabaseAdmin
        .from('email_messages')
        .update({
          kind:       context.kind ?? null,
          tender_id:  context.tenderId ?? null,
          invitee_id: context.inviteeId ?? null,
          project_id: context.projectId ?? null,
          sent_by:    context.sentBy ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('resend_id', resendId);
    } else if (error) {
      console.warn(`[emailLog] Could not log send to ${recipient}: ${error.message}`);
    }
  } catch (logErr: any) {
    console.warn(`[emailLog] Logging failed for ${recipient}: ${logErr?.message}`);
  }
}

/**
 * Sends via Resend and logs the attempt.
 * Returns the Resend message id. Throws if the send failed.
 */
export async function sendTrackedEmail(
  resend: any,
  supabaseAdmin: any,
  payload: Record<string, unknown>,
  context: EmailContext = {},
): Promise<string> {
  let result: any = null;
  let thrownError: string | null = null;

  try {
    result = await resend.emails.send(payload);
  } catch (err: any) {
    thrownError = err?.message ?? String(err);
  }

  const resendId = result?.data?.id ?? null;
  const failure  =
    thrownError ??
    result?.error?.message ??
    (resendId ? null : 'Resend did not return a message ID');

  const to = payload.to;
  const recipient = Array.isArray(to) ? to[0] : (to as string) ?? 'unknown';

  await logEmailSend(supabaseAdmin, {
    resendId,
    recipient,
    subject: (payload.subject as string) ?? null,
    failure,
    context,
  });

  if (failure) throw new Error(failure);
  return resendId;
}
