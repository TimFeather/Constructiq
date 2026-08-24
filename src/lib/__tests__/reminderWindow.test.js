import { describe, it, expect } from 'vitest';
import { daysUntilNZ, nzToday } from '../../../supabase/functions/_shared/reminderWindow.ts';

// Tender closes Wednesday 26 Aug 2026, 5:00 PM NZST.
const CLOSING = '2026-08-26T17:00:00';

describe('daysUntilNZ', () => {
  it('reads 1 day away when the cron fires at 19:00 UTC the day before (not 2)', () => {
    // Mon 19:00 UTC = Tue 07:00 NZST -> "today" is Tue 25 Aug, target is Wed 26 Aug.
    const now = new Date('2026-08-24T19:00:00Z');
    expect(daysUntilNZ(CLOSING, now)).toBe(1);
  });

  it('reads 2 days away when the cron fires at 19:00 UTC two days before', () => {
    // Sun 19:00 UTC = Mon 07:00 NZST -> "today" is Mon 24 Aug.
    const now = new Date('2026-08-23T19:00:00Z');
    expect(daysUntilNZ(CLOSING, now)).toBe(2);
  });

  it('reads 0 on the closing day itself', () => {
    // Tue 19:00 UTC = Wed 07:00 NZST -> "today" is Wed 26 Aug, same as target.
    const now = new Date('2026-08-25T19:00:00Z');
    expect(daysUntilNZ(CLOSING, now)).toBe(0);
  });

  it('reads -1 the day after closing', () => {
    // Wed 19:00 UTC = Thu 07:00 NZST -> "today" is Thu 27 Aug, target was Wed 26 Aug.
    const now = new Date('2026-08-26T19:00:00Z');
    expect(daysUntilNZ(CLOSING, now)).toBe(-1);
  });

  it('is correct in NZDT (January, UTC+13)', () => {
    // Closing Fri 16 Jan 2026, 5pm NZDT. Two days before: Tue 19:00 UTC = Wed 08:00 NZDT -> today = 14 Jan.
    const now = new Date('2026-01-13T19:00:00Z');
    expect(daysUntilNZ('2026-01-16T17:00:00', now)).toBe(2);
  });

  it('is correct in NZST (July, UTC+12)', () => {
    // Closing Fri 17 Jul 2026, 5pm NZST. Two days before: Tue 19:00 UTC = Wed 07:00 NZST -> today = 15 Jul.
    const now = new Date('2026-07-14T19:00:00Z');
    expect(daysUntilNZ('2026-07-17T17:00:00', now)).toBe(2);
  });

  it('handles a date-only value with no T part', () => {
    const now = new Date('2026-08-24T19:00:00Z'); // today NZ = Tue 25 Aug
    expect(daysUntilNZ('2026-08-26', now)).toBe(1);
  });

  it('returns null for null, empty string, and unparseable input', () => {
    expect(daysUntilNZ(null)).toBeNull();
    expect(daysUntilNZ('')).toBeNull();
    expect(daysUntilNZ('not-a-date')).toBeNull();
    expect(daysUntilNZ('2026-13-40')).toBeNull();
  });
});

describe('nzToday', () => {
  it('returns YYYY-MM-DD for a given instant, shifted into NZ', () => {
    // 19:00 UTC on 24 Aug is already 07:00 NZST on 25 Aug.
    expect(nzToday(new Date('2026-08-24T19:00:00Z'))).toBe('2026-08-25');
  });

  it('does not roll over before NZ midnight', () => {
    // 10:00 UTC on 24 Aug is still 22:00 NZST on 24 Aug.
    expect(nzToday(new Date('2026-08-24T10:00:00Z'))).toBe('2026-08-24');
  });
});
