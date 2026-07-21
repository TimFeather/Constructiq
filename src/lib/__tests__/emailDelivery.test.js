// Delivery-badge resolution for tender invitees.
//
// The case that prompted these: an invitation bounced at 03:47, the operator
// hit Resend at 03:52, and the badge flipped back to 'Sent' — hiding the dead
// address behind an in-flight retry. A bounce must survive a resend until a
// later message actually lands.
import { describe, it, expect } from 'vitest';
import { resolveDeliveryDisplay, explainDeliveryFailure } from '@/lib/emailDelivery';

describe('resolveDeliveryDisplay', () => {
  it('returns null when the invitee has no email history', () => {
    expect(resolveDeliveryDisplay(null)).toBeNull();
    expect(resolveDeliveryDisplay(undefined)).toBeNull();
  });

  it('reports a plain delivered message as no problem', () => {
    const d = resolveDeliveryDisplay({ status: 'delivered', failure_status: null });
    expect(d).toMatchObject({ status: 'delivered', isProblem: false, retryInFlight: false });
  });

  it('reports a bounce with no resend as a problem', () => {
    const d = resolveDeliveryDisplay({
      status: 'bounced', failure_status: 'bounced',
      error_message: 'unable to lookup DNS for barenuckle.co.nz',
    });
    expect(d.status).toBe('bounced');
    expect(d.isProblem).toBe(true);
    expect(d.retryInFlight).toBe(false);
    expect(d.explanation).toMatch(/does not resolve/i);
  });

  // The regression this file exists for.
  it('keeps showing the bounce while a resend is still in flight', () => {
    const d = resolveDeliveryDisplay({
      status: 'sent',                 // the 03:52 resend
      failure_status: 'bounced',      // the 03:47 original
      error_message: 'unable to lookup DNS for test.me',
    });
    expect(d.status).toBe('bounced');
    expect(d.isProblem).toBe(true);
    expect(d.retryInFlight).toBe(true);
  });

  it('clears the bounce once a later message actually lands', () => {
    for (const landed of ['delivered', 'opened', 'clicked']) {
      const d = resolveDeliveryDisplay({ status: landed, failure_status: 'bounced' });
      expect(d.status).toBe(landed);
      expect(d.isProblem).toBe(false);
    }
  });

  it('does not treat an in-flight first send as a problem', () => {
    const d = resolveDeliveryDisplay({ status: 'sent', failure_status: null });
    expect(d).toMatchObject({ status: 'sent', isProblem: false });
  });

  // Migration 024: problems from senders that log no invitee context are
  // matched to the invitee by email address, so `status` (which only counts
  // explicitly linked messages) is null.
  it('shows an address-matched problem when there is no linked message', () => {
    const d = resolveDeliveryDisplay({
      status: null,
      failure_status: 'delayed',
      error_message: null,
    });
    expect(d.status).toBe('delayed');
    expect(d.isProblem).toBe(true);
    expect(d.explanation).toMatch(/not accepting mail yet/i);
  });

  it('does not claim a resend is in flight when nothing was resent', () => {
    const d = resolveDeliveryDisplay({ status: null, failure_status: 'bounced' });
    expect(d.retryInFlight).toBe(false);
  });

  it('returns null when there is neither a status nor a failure', () => {
    expect(resolveDeliveryDisplay({ status: null, failure_status: null })).toBeNull();
  });

  it('surfaces a spam complaint even though mail was delivered', () => {
    const d = resolveDeliveryDisplay({ status: 'complained', failure_status: 'complained' });
    expect(d.isProblem).toBe(true);
    expect(d.explanation).toMatch(/spam/i);
  });
});

describe('explainDeliveryFailure', () => {
  it('translates the DNS bounce that started this', () => {
    expect(explainDeliveryFailure({
      status: 'bounced',
      error_type: 'Transient',
      error_message: 'smtp; 550 4.4.7 Message expired: unable to deliver in 840 minutes.'
                   + '<421 4.4.0 Unable to lookup DNS for barenuckle.co.nz>',
    })).toMatch(/does not resolve/i);
  });

  it('distinguishes a bad mailbox from a bad domain', () => {
    expect(explainDeliveryFailure({
      status: 'bounced', error_message: '550 5.1.1 No such user here',
    })).toMatch(/mailbox does not exist/i);
  });

  it('flags a full mailbox as the recipient\'s problem', () => {
    expect(explainDeliveryFailure({
      status: 'bounced', error_message: '452 4.2.2 Mailbox full',
    })).toMatch(/mailbox is full/i);
  });

  it('returns nothing for a healthy message', () => {
    expect(explainDeliveryFailure({ status: 'delivered' })).toBeNull();
    expect(explainDeliveryFailure(null)).toBeNull();
  });
});
