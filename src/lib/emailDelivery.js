/**
 * emailDelivery
 *
 * Presentation helpers for Resend delivery statuses recorded in
 * email_messages by the resendWebhook edge function.
 */

export const DELIVERY_STATUS_STYLES = {
  queued:     'bg-gray-100 text-gray-600',
  scheduled:  'bg-gray-100 text-gray-600',
  sent:       'bg-blue-100 text-blue-700',
  delayed:    'bg-amber-100 text-amber-800',
  delivered:  'bg-green-100 text-green-700',
  opened:     'bg-emerald-100 text-emerald-700',
  clicked:    'bg-emerald-100 text-emerald-800',
  bounced:    'bg-red-100 text-red-700',
  complained: 'bg-orange-100 text-orange-800',
  failed:     'bg-red-100 text-red-700',
};

export const DELIVERY_STATUS_LABELS = {
  queued:     'Queued',
  scheduled:  'Scheduled',
  sent:       'Sent',
  delayed:    'Delayed',
  delivered:  'Delivered',
  opened:     'Opened',
  clicked:    'Clicked',
  bounced:    'Bounced',
  complained: 'Spam report',
  failed:     'Failed',
};

/** Statuses that mean the recipient did not get the email. */
export const FAILED_STATUSES = ['bounced', 'failed'];

/** Statuses worth drawing the user's attention to. */
export const PROBLEM_STATUSES = [...FAILED_STATUSES, 'complained', 'delayed'];

export function isDeliveryFailure(status) {
  return FAILED_STATUSES.includes(status);
}

export function isDeliveryProblem(status) {
  return PROBLEM_STATUSES.includes(status);
}

/**
 * Turns a bounce into something a site manager can act on.
 * Resend's own message is an SMTP response, which is not self-explanatory.
 */
export function explainDeliveryFailure(msg) {
  if (!msg) return null;
  const { status, error_type, error_subtype, error_message } = msg;

  if (status === 'complained') {
    return 'Recipient marked this as spam. Resend will suppress future sends to this address.';
  }
  if (status === 'delayed') {
    return 'The receiving server is not accepting mail yet. Resend is still retrying.';
  }
  if (!isDeliveryFailure(status)) return null;

  const raw = String(error_message || '');

  if (/unable to lookup dns|dns.*(?:lookup|error)|no such domain|nxdomain/i.test(raw)) {
    return 'The recipient\'s domain does not resolve — usually a typo in the address, or a lapsed domain. Check the spelling before resending.';
  }
  if (/no such user|user unknown|mailbox.*(?:not found|unavailable)|does not exist|recipient rejected/i.test(raw)) {
    return 'The domain is valid but the mailbox does not exist. Check the part before the @.';
  }
  if (/mailbox full|over quota|quota exceeded|insufficient storage/i.test(raw)) {
    return 'The recipient\'s mailbox is full. They will need to clear space before mail can arrive.';
  }
  if (/suppress/i.test(raw) || error_subtype === 'Suppressed') {
    return 'This address is on the suppression list from an earlier bounce or complaint. Remove it in Resend before retrying.';
  }
  if (/spam|blocked|blacklist|policy|reputation/i.test(raw)) {
    return 'The receiving server rejected the message as spam or by policy.';
  }
  if (error_type === 'Transient') {
    return 'A temporary problem at the receiving end. Resend retried for up to 14 hours before giving up — resending later may work.';
  }
  return 'Permanent delivery failure. The address will not accept mail as written.';
}

export function formatDeliveryTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-NZ', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
