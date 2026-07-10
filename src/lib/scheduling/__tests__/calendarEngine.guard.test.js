import { describe, it, expect } from 'vitest';
import { nextWorkingDay, addWorkingDays, validateCalendar, DEFAULT_CALENDAR } from '../calendarEngine.js';

describe('calendar guard rails', () => {
  it('nextWorkingDay throws (fast) when the calendar has no working day for millennia', () => {
    const calendar = {
      type: '5day',
      holidays: [],
      shutdowns: [{ start: '2000-01-01', end: '2999-12-31' }],
    };
    const start = Date.now();
    expect(() => nextWorkingDay('2100-01-01', calendar)).toThrow(/no working day/);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('addWorkingDays over a normal calendar with a shutdown still returns the correct date', () => {
    const calendar = {
      type: '5day',
      holidays: ['2026-07-08'],
      shutdowns: [],
    };
    // Mon 2026-07-06, add 5 working days, skipping the 2026-07-08 holiday
    const result = addWorkingDays('2026-07-06', 5, calendar);
    const yyyyMMdd = `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
    expect(yyyyMMdd).toBe('2026-07-14');
  });

  it('validateCalendar flags a reversed shutdown range', () => {
    const problems = validateCalendar({ type: '5day', holidays: [], shutdowns: [{ start: '2026-02-01', end: '2026-01-01' }] });
    expect(problems.some(p => /ends before it starts/.test(p))).toBe(true);
  });

  it('validateCalendar flags a bad date format', () => {
    const problems = validateCalendar({ type: '5day', holidays: ['07/08/2026'], shutdowns: [] });
    expect(problems.some(p => /not in yyyy-MM-dd format/.test(p))).toBe(true);
  });

  it('validateCalendar returns [] for DEFAULT_CALENDAR', () => {
    expect(validateCalendar(DEFAULT_CALENDAR)).toEqual([]);
  });
});
