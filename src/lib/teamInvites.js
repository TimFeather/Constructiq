/**
 * Staged ("Draft") project team members.
 *
 * A sub added on the Subcontractors tab waits on project.team until someone
 * clicks Send Invites, like a tender invitee before the tender is issued:
 *
 *   { full_name, business_name, phone, role, trade, quote_ref,
 *     invite_email, invite_status: 'Draft', draft_id, added_at }
 *
 * The email lives in invite_email, not user_email, on purpose. Project access
 * (RLS: team @> [{ user_email }]), My Tasks, programme assignees and every
 * notification key off user_email, so a Draft can't see the project or be
 * emailed by anything until its invite goes out. Sending turns it into a
 * normal member: { ...,  user_email, invite_status: 'Invited', invited_at }
 * (or, for someone who already has an account, invitationService's
 * addExistingUser adds them and the Draft is dropped).
 */

import { normalizeEmail } from '@/lib/normalizeEmail';

export const isDraftMember = (m) => m?.invite_status === 'Draft';

/** A member's email whether they're invited yet or not, normalised. */
export const memberEmail = (m) => normalizeEmail(m?.user_email || m?.invite_email || '');
