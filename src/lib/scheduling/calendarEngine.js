/**
 * Calendar Engine
 * Handles working-day calculations with support for:
 * - 5-day, 6-day, 7-day calendars
 * - Public holidays
 * - Company/project shutdown periods
 */

export const CALENDAR_TYPES = {
  FIVE_DAY: '5day',
  SIX_DAY: '6day',
  SEVEN_DAY: '7day',
};

export const WORK_HOURS_PER_DAY = 8;

/** Max days any working-day search may scan before we declare the calendar broken. */
export const MAX_CALENDAR_SCAN_DAYS = 10000; // ~27 years

/**
 * Default 5-day calendar (Mon–Fri)
 */
export const DEFAULT_CALENDAR = {
  type: CALENDAR_TYPES.FIVE_DAY,
  holidays: [],       // ['yyyy-MM-dd', ...]
  shutdowns: [],      // [{ start: 'yyyy-MM-dd', end: 'yyyy-MM-dd' }, ...]
};

/**
 * Is this date a working day for the given calendar?
 */
export function isWorkingDay(date, calendar = DEFAULT_CALENDAR) {
  const d = new Date(date);
  const dow = d.getDay(); // 0=Sun, 6=Sat

  // Check weekend based on calendar type
  if (calendar.type === CALENDAR_TYPES.FIVE_DAY) {
    if (dow === 0 || dow === 6) return false;
  } else if (calendar.type === CALENDAR_TYPES.SIX_DAY) {
    if (dow === 0) return false; // Only Sunday off
  }
  // SEVEN_DAY: all days are working days

  const dateStr = toDateStr(d);

  // Check holidays
  if ((calendar.holidays || []).includes(dateStr)) return false;

  // Check shutdown periods
  for (const shutdown of (calendar.shutdowns || [])) {
    if (dateStr >= shutdown.start && dateStr <= shutdown.end) return false;
  }

  return true;
}

/**
 * Get the next working day on or after the given date
 */
export function nextWorkingDay(date, calendar = DEFAULT_CALENDAR) {
  let d = new Date(date);
  d.setHours(0, 0, 0, 0);
  let scanned = 0;
  while (!isWorkingDay(d, calendar)) {
    if (++scanned > MAX_CALENDAR_SCAN_DAYS) {
      throw new Error(`Calendar has no working day within ${MAX_CALENDAR_SCAN_DAYS} days of ${toDateStr(d)} — check holidays/shutdown ranges.`);
    }
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/**
 * Get the previous working day on or before the given date
 */
export function prevWorkingDay(date, calendar = DEFAULT_CALENDAR) {
  let d = new Date(date);
  d.setHours(0, 0, 0, 0);
  let scanned = 0;
  while (!isWorkingDay(d, calendar)) {
    if (++scanned > MAX_CALENDAR_SCAN_DAYS) {
      throw new Error(`Calendar has no working day within ${MAX_CALENDAR_SCAN_DAYS} days of ${toDateStr(d)} — check holidays/shutdown ranges.`);
    }
    d.setDate(d.getDate() - 1);
  }
  return d;
}

/**
 * Add N working days to a date (can be negative for backward movement)
 */
export function addWorkingDays(startDate, days, calendar = DEFAULT_CALENDAR) {
  if (days === 0) return new Date(startDate);
  const d = new Date(startDate);
  d.setHours(0, 0, 0, 0);
  const sign = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  let scanned = 0;

  while (remaining > 0) {
    if (++scanned > MAX_CALENDAR_SCAN_DAYS) {
      throw new Error(`Calendar has no working day within ${MAX_CALENDAR_SCAN_DAYS} days of ${toDateStr(d)} — check holidays/shutdown ranges.`);
    }
    d.setDate(d.getDate() + sign);
    if (isWorkingDay(d, calendar)) {
      remaining--;
    }
  }
  return d;
}

/**
 * Add working hours to a date (calendar-aware)
 * Positive = forward, negative = backward
 */
export function addWorkingHours(startDate, hours, calendar = DEFAULT_CALENDAR) {
  if (hours === 0) return new Date(startDate);
  const days = hours / WORK_HOURS_PER_DAY;
  return addWorkingDays(startDate, days, calendar);
}

/**
 * Add elapsed (24/7) hours to a date
 */
export function addElapsedHours(startDate, hours) {
  return new Date(new Date(startDate).getTime() + hours * 3600000);
}

// ─── Continuous working-hour timeline ────────────────────────────────────────
//
// The CPM engine schedules on a continuous "working-hour" timeline: a single
// number that counts working hours elapsed since the START (08:00) of a fixed
// anchor day. Each working day contributes exactly WORK_HOURS_PER_DAY (8) hours
// to the timeline; weekends, holidays and shutdowns contribute nothing. This
// lets two 4h tasks pack into one calendar day (hour 0–4 and hour 4–8 both live
// on the anchor day) the way MS Project schedules clock hours within 08:00–17:00.
//
// Hour value h decomposes as: dayIndex = floor(h / 8) working days after the
// anchor, plus an intra-day offset of (h mod 8) hours into that working day.
// A whole-day boundary (h a multiple of 8) is the START (08:00) of a working day.

/**
 * Working-hour offset of the START (hour 0 / 08:00) of `date`'s calendar day,
 * measured from the START of the `anchor` day. Walks actual working days, so
 * weekends/holidays between anchor and date do not add hours.
 *
 * If `date` itself is a non-working day it is first snapped to the next working
 * day (its hour offset is that of the following working day's start). Dates
 * before the anchor yield negative offsets.
 */
export function dateToWorkingHours(date, anchor, calendar = DEFAULT_CALENDAR) {
  const target = new Date(date); target.setHours(0, 0, 0, 0);
  const base = new Date(anchor); base.setHours(0, 0, 0, 0);
  if (target.getTime() === base.getTime()) return 0;

  if (target > base) {
    // Count working days strictly between base and target (target exclusive is
    // the start-of-day offset). Snapping falls out: a non-working target counts
    // the same working days as the next working day's start.
    return countWorkingDays(base, target, calendar) * WORK_HOURS_PER_DAY;
  }
  // target < base: negative offset, counting working days in [target, base).
  return -countWorkingDays(target, base, calendar) * WORK_HOURS_PER_DAY;
}

/**
 * The calendar Date (local midnight) of the working day that CONTAINS the
 * given working-hour offset from the anchor's day start. hour 0 → anchor day,
 * hour 8 → next working day's start, hour 4 → still the anchor day.
 *
 * Negative hours walk backward through working days. A fractional hour lands on
 * the same day as its floor (the working day it falls within).
 */
export function workingHoursToDate(hours, anchor, calendar = DEFAULT_CALENDAR) {
  const base = nextWorkingDay(anchor, calendar);
  const dayIndex = Math.floor(hours / WORK_HOURS_PER_DAY);
  if (dayIndex === 0) return new Date(base);
  return addWorkingDays(base, dayIndex, calendar);
}

/**
 * Add fractional working hours to a date, honouring the calendar and the
 * intra-day 8h clock, returning the calendar day the resulting instant lands on.
 * Unlike the legacy addWorkingHours (which divides by 8 and delegates to whole
 * days), this respects sub-day packing via the working-hour timeline.
 */
export function addWorkingHoursExact(startDate, hours, calendar = DEFAULT_CALENDAR) {
  const anchor = nextWorkingDay(startDate, calendar);
  const startH = dateToWorkingHours(anchor, anchor, calendar); // 0
  return workingHoursToDate(startH + hours, anchor, calendar);
}

/**
 * Count working days between two dates (inclusive of start, exclusive of end)
 */
export function countWorkingDays(startDate, endDate, calendar = DEFAULT_CALENDAR) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (start >= end) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < end) {
    if (isWorkingDay(cur, calendar)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Format date to yyyy-MM-dd using LOCAL date components.
 * Never use toISOString here: parseDate() creates local-midnight dates,
 * and in UTC+ timezones (NZ is UTC+12/13) toISOString rolls them back to
 * the previous day — shifting every schedule date and holiday match.
 */
export function toDateStr(date) {
  if (!date) return null;
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse yyyy-MM-dd to Date at midnight */
export function parseDate(str) {
  if (!str) return null;
  return new Date(str + 'T00:00:00');
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SHUTDOWN_DAYS = 400;

/**
 * Returns a list of human-readable problems with a calendar config, [] if fine.
 * Checks: shutdown ranges with end < start; shutdown ranges longer than 400 days;
 * holidays/shutdown dates that fail /^\d{4}-\d{2}-\d{2}$/.
 */
export function validateCalendar(calendar) {
  const problems = [];
  if (!calendar) return problems;

  for (const holiday of (calendar.holidays || [])) {
    if (!ISO_DATE_RE.test(holiday)) {
      problems.push(`Holiday date "${holiday}" is not in yyyy-MM-dd format`);
    }
  }

  for (const shutdown of (calendar.shutdowns || [])) {
    const { start, end } = shutdown;
    if (!ISO_DATE_RE.test(start)) {
      problems.push(`Shutdown start date "${start}" is not in yyyy-MM-dd format`);
      continue;
    }
    if (!ISO_DATE_RE.test(end)) {
      problems.push(`Shutdown end date "${end}" is not in yyyy-MM-dd format`);
      continue;
    }
    if (end < start) {
      problems.push(`Shutdown range ${start} – ${end} ends before it starts`);
      continue;
    }
    const days = (parseDate(end) - parseDate(start)) / 86400000;
    if (days > MAX_SHUTDOWN_DAYS) {
      problems.push(`Shutdown range ${start} – ${end} is longer than ${MAX_SHUTDOWN_DAYS} days`);
    }
  }

  return problems;
}