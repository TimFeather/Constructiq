import { describe, it, expect } from 'vitest';
import {
  getNzHolidays,
  getNzHolidaysForRange,
  buildProjectCalendar,
} from '../nzHolidays.js';

describe('getNzHolidays', () => {
  it('computes Easter 2026 correctly (Easter Sunday 2026-04-05)', () => {
    const holidays = getNzHolidays(2026);
    expect(holidays).toContain('2026-04-03'); // Good Friday
    expect(holidays).toContain('2026-04-06'); // Easter Monday
  });

  it('mondayises Waitangi Day 2027 (Feb 6 falls on Saturday)', () => {
    const holidays = getNzHolidays(2027);
    expect(holidays).toContain('2027-02-08');
    expect(holidays).not.toContain('2027-02-06');
  });

  it('mondayises ANZAC Day 2026 (Apr 25 falls on Saturday)', () => {
    const holidays = getNzHolidays(2026);
    expect(holidays).toContain('2026-04-27');
    expect(holidays).not.toContain('2026-04-25');
  });

  it('mondayises Christmas/Boxing Day pair for 2027 (Sat/Sun)', () => {
    const holidays = getNzHolidays(2027);
    // Dec 25 2027 = Saturday -> observed Monday 27th
    expect(holidays).toContain('2027-12-27');
    // Dec 26 2027 = Sunday -> observed Tuesday 28th (collides with Monday 27th)
    expect(holidays).toContain('2027-12-28');
    expect(holidays).not.toContain('2027-12-25');
    expect(holidays).not.toContain('2027-12-26');
  });

  it('mondayises New Year pair for 2028 (Sat/Sun)', () => {
    const holidays = getNzHolidays(2028);
    // Jan 1 2028 = Saturday -> observed Monday Jan 3
    expect(holidays).toContain('2028-01-03');
    // Jan 2 2028 = Sunday -> observed Tuesday Jan 4 (collides with Monday Jan 3)
    expect(holidays).toContain('2028-01-04');
    expect(holidays).not.toContain('2028-01-01');
    expect(holidays).not.toContain('2028-01-02');
  });

  it('includes the hardcoded Matariki date for 2026', () => {
    const holidays = getNzHolidays(2026);
    expect(holidays).toContain('2026-07-10');
  });

  it('omits Matariki for years outside the Gazette table (does not throw)', () => {
    expect(() => getNzHolidays(2050)).not.toThrow();
    const holidays = getNzHolidays(2050);
    // None of the tabulated Matariki dates should be present, and the
    // result should still contain the other calculable holidays.
    expect(holidays.length).toBeGreaterThan(0);
  });

  it('computes Labour Day 2026 (fourth Monday of October) and Hawkes Bay anniversary', () => {
    const holidays = getNzHolidays(2026, { region: 'hawkes-bay' });
    expect(holidays).toContain('2026-10-26'); // Labour Day
    expect(holidays).toContain('2026-10-23'); // Friday before Labour Day
  });

  it('computes Kings Birthday 2026 (first Monday of June)', () => {
    const holidays = getNzHolidays(2026);
    expect(holidays).toContain('2026-06-01');
  });

  it('defaults to the hawkes-bay region when none is specified', () => {
    const withDefault = getNzHolidays(2026);
    const withExplicit = getNzHolidays(2026, { region: 'hawkes-bay' });
    expect(withDefault).toEqual(withExplicit);
  });

  it('returns no regional anniversary for an unknown/absent region', () => {
    const holidays = getNzHolidays(2026, { region: 'unknown-region' });
    expect(holidays).not.toContain('2026-10-23');
  });

  it('never returns duplicates and is always sorted', () => {
    const holidays = getNzHolidays(2026);
    const unique = Array.from(new Set(holidays));
    expect(holidays.length).toBe(unique.length);
    const sorted = [...holidays].sort();
    expect(holidays).toEqual(sorted);
  });
});

describe('getNzHolidaysForRange', () => {
  it('concatenates unique, sorted holidays across an inclusive year range', () => {
    const range = getNzHolidaysForRange(2026, 2027);
    const y2026 = getNzHolidays(2026);
    const y2027 = getNzHolidays(2027);

    expect(range.length).toBe(y2026.length + y2027.length);
    expect(range).toEqual([...range].sort());
    for (const d of y2026) expect(range).toContain(d);
    for (const d of y2027) expect(range).toContain(d);
  });
});

describe('buildProjectCalendar', () => {
  it('returns a default 5-day calendar with generated holidays when programme is null', () => {
    const cal = buildProjectCalendar(null, 2026, 2027);
    expect(cal.type).toBe('5day');
    expect(cal.hours_per_day).toBe(8);
    expect(cal.shutdowns).toEqual([]);
    expect(cal.holidays).toContain('2026-10-26'); // Labour Day 2026
    expect(cal.holidays).toContain('2027-10-25'); // Labour Day 2027
  });

  it('returns a default calendar when programme is undefined', () => {
    const cal = buildProjectCalendar(undefined, 2026, 2026);
    expect(cal.type).toBe('5day');
    expect(cal.holidays.length).toBeGreaterThan(0);
  });

  it('merges manually-listed holidays with generated ones, deduped and sorted', () => {
    const programme = {
      calendar: {
        type: '6day',
        holidays: ['2026-12-24', '2026-10-26'], // second one duplicates Labour Day
        shutdowns: [{ start: '2026-12-24', end: '2027-01-05' }],
        hours_per_day: 10,
        region: 'hawkes-bay',
      },
    };
    const cal = buildProjectCalendar(programme, 2026, 2026);

    expect(cal.type).toBe('6day');
    expect(cal.hours_per_day).toBe(10);
    expect(cal.shutdowns).toEqual([{ start: '2026-12-24', end: '2027-01-05' }]);
    expect(cal.holidays).toContain('2026-12-24');
    expect(cal.holidays).toContain('2026-10-26');

    const unique = Array.from(new Set(cal.holidays));
    expect(cal.holidays.length).toBe(unique.length);
    expect(cal.holidays).toEqual([...cal.holidays].sort());
  });

  it('defaults type and hours_per_day when the programme calendar omits them', () => {
    const programme = { calendar: {} };
    const cal = buildProjectCalendar(programme, 2026, 2026);
    expect(cal.type).toBe('5day');
    expect(cal.hours_per_day).toBe(8);
  });
});
