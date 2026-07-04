import { describe, it, expect } from 'vitest';
import {
  toDateStr, parseDate, isWorkingDay, addWorkingDays, countWorkingDays, nextWorkingDay,
} from '../calendarEngine.js';

const CAL = { type: '5day', holidays: [], shutdowns: [] };

describe('toDateStr / parseDate', () => {
  it('round-trips without timezone shift (NZ UTC+12/13 regression)', () => {
    // toISOString() would roll local midnight back a day in UTC+ zones
    expect(toDateStr(parseDate('2026-07-03'))).toBe('2026-07-03');
    expect(toDateStr(parseDate('2026-01-01'))).toBe('2026-01-01');
    expect(toDateStr(parseDate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('isWorkingDay', () => {
  it('excludes weekends on a 5-day calendar', () => {
    expect(isWorkingDay(parseDate('2026-01-05'), CAL)).toBe(true);  // Mon
    expect(isWorkingDay(parseDate('2026-01-10'), CAL)).toBe(false); // Sat
    expect(isWorkingDay(parseDate('2026-01-11'), CAL)).toBe(false); // Sun
  });

  it('excludes holidays (local-date matching)', () => {
    const cal = { ...CAL, holidays: ['2026-07-10'] }; // Matariki, a Friday
    expect(isWorkingDay(parseDate('2026-07-10'), cal)).toBe(false);
    expect(isWorkingDay(parseDate('2026-07-09'), cal)).toBe(true);
  });

  it('excludes shutdown periods', () => {
    const cal = { ...CAL, shutdowns: [{ start: '2026-12-24', end: '2027-01-05' }] };
    expect(isWorkingDay(parseDate('2026-12-29'), cal)).toBe(false); // Tue inside shutdown
    expect(isWorkingDay(parseDate('2027-01-06'), cal)).toBe(true);  // Wed after
  });
});

describe('addWorkingDays', () => {
  it('skips weekends', () => {
    // Fri 9 Jan + 1 working day = Mon 12 Jan
    expect(toDateStr(addWorkingDays(parseDate('2026-01-09'), 1, CAL))).toBe('2026-01-12');
  });

  it('skips holidays too', () => {
    const cal = { ...CAL, holidays: ['2026-01-12'] };
    expect(toDateStr(addWorkingDays(parseDate('2026-01-09'), 1, cal))).toBe('2026-01-13');
  });

  it('moves backward over weekends', () => {
    // Mon 12 Jan - 1 working day = Fri 9 Jan
    expect(toDateStr(addWorkingDays(parseDate('2026-01-12'), -1, CAL))).toBe('2026-01-09');
  });
});

describe('countWorkingDays', () => {
  it('counts Mon..Fri as 5 (start inclusive, end exclusive)', () => {
    expect(countWorkingDays(parseDate('2026-01-05'), parseDate('2026-01-10'), CAL)).toBe(5);
  });

  it('excludes holidays', () => {
    const cal = { ...CAL, holidays: ['2026-01-07'] };
    expect(countWorkingDays(parseDate('2026-01-05'), parseDate('2026-01-10'), cal)).toBe(4);
  });
});

describe('nextWorkingDay', () => {
  it('rolls Saturday forward to Monday', () => {
    expect(toDateStr(nextWorkingDay(parseDate('2026-01-10'), CAL))).toBe('2026-01-12');
  });
});
