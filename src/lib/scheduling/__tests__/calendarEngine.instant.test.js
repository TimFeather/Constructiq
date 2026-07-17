import { describe, it, expect } from 'vitest';
import {
  parseDate, nextWorkingDay, workingHourToInstant, instantToWorkingHours,
} from '../calendarEngine.js';

const CAL = { type: '5day', holidays: [], shutdowns: [] };

// 2026-01-05 is a Monday.
const ANCHOR = nextWorkingDay(parseDate('2026-01-05'), CAL);

describe('workingHourToInstant', () => {
  it('resolves a whole-day boundary to Friday 16:00 with finishBoundary, Monday 08:00 without', () => {
    // hour 40 = 5 working days from Monday anchor = following Monday 08:00
    const asStart = workingHourToInstant(40, ANCHOR, CAL);
    expect(asStart.getFullYear()).toBe(2026);
    expect(asStart.getMonth()).toBe(0);
    expect(asStart.getDate()).toBe(12); // Monday 12th
    expect(asStart.getHours()).toBe(8);

    const asFinish = workingHourToInstant(40, ANCHOR, CAL, { finishBoundary: true });
    expect(asFinish.getDate()).toBe(9); // Friday 9th
    expect(asFinish.getHours()).toBe(16);
  });

  it('resolves an intra-day hour identically regardless of finishBoundary', () => {
    const h = 3.5; // 11:30 on the anchor day
    const a = workingHourToInstant(h, ANCHOR, CAL);
    const b = workingHourToInstant(h, ANCHOR, CAL, { finishBoundary: true });
    expect(a.getTime()).toBe(b.getTime());
    expect(a.getHours()).toBe(11);
    expect(a.getMinutes()).toBe(30);
  });
});

describe('instantToWorkingHours round-trip', () => {
  it('round-trips for whole and fractional hours (finishBoundary: false)', () => {
    for (const h of [0, 3.5, 8, 12, 40]) {
      const instant = workingHourToInstant(h, ANCHOR, CAL);
      const back = instantToWorkingHours(instant, ANCHOR, CAL);
      expect(back).toBeCloseTo(h, 6);
    }
  });

  it('snaps an instant before 08:00 forward to 08:00 same day', () => {
    const early = new Date(ANCHOR);
    early.setHours(6, 0, 0, 0);
    expect(instantToWorkingHours(early, ANCHOR, CAL)).toBe(0);
  });

  it('snaps an instant after 16:00 forward to next working day 08:00', () => {
    const late = new Date(ANCHOR);
    late.setHours(18, 0, 0, 0);
    expect(instantToWorkingHours(late, ANCHOR, CAL)).toBe(8);
  });

  it('snaps a non-working day forward to the next working day 08:00', () => {
    // Saturday 10 Jan 2026, any clock time — snaps to Monday 12th (5 working
    // days after the Monday 5th anchor, since Mon 12th is a whole week later)
    const sat = new Date(2026, 0, 10, 12, 0, 0, 0);
    expect(instantToWorkingHours(sat, ANCHOR, CAL)).toBe(40);
  });
});
