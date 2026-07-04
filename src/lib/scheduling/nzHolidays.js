/**
 * NZ Public Holidays
 * Computes New Zealand statutory public holidays (national + regional
 * anniversary) for a given calendar year, applying the Mondayisation
 * rules that have been in effect since the Holidays (Full Recognition
 * of Waitangi Day and ANZAC Day) Amendment Act 2013 (in force from 2014).
 *
 * All dates are returned as 'yyyy-MM-dd' strings built from local date
 * components (getFullYear/getMonth/getDate) — never from toISOString,
 * which would shift the date under non-UTC timezones.
 */

/** Matariki is set by Order in Council each year — no formula, so we hardcode the Gazette dates. */
const MATARIKI_DATES = {
  2022: '2022-06-24',
  2023: '2023-07-14',
  2024: '2024-06-28',
  2025: '2025-06-20',
  2026: '2026-07-10',
  2027: '2027-06-25',
  2028: '2028-07-14',
  2029: '2029-07-06',
  2030: '2030-06-21',
  2031: '2031-07-11',
  2032: '2032-07-02',
  2033: '2033-06-24',
  2034: '2034-07-07',
  2035: '2035-06-29',
};

/** Format a Date using its LOCAL date components as 'yyyy-MM-dd'. */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Build a local Date at midnight from year/month(1-based)/day. */
function makeDate(year, month, day) {
  return new Date(year, month - 1, day);
}

/** Add N days to a Date, returning a new Date. */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** 0 = Sunday, 6 = Saturday */
function dayOfWeek(date) {
  return date.getDay();
}

/**
 * Mondayise a single holiday: if it falls on Saturday or Sunday, move it
 * to the following Monday. Otherwise it stays put.
 */
function mondayise(date) {
  const dow = dayOfWeek(date);
  if (dow === 6) return addDays(date, 2); // Sat -> Mon
  if (dow === 0) return addDays(date, 1); // Sun -> Mon
  return date;
}

/**
 * Mondayise a PAIR of adjacent holidays (New Year's Day/Day after, and
 * Christmas Day/Boxing Day) using the standard NZ two-step rule:
 *  1. The first holiday is observed on the next weekday (Monday) if it
 *     falls on a Saturday or Sunday, else on its actual date.
 *  2. The second holiday is observed on the next weekday that is not
 *     already taken by the first holiday's observed date — this can
 *     push it to Tuesday when both fall on a weekend.
 */
function mondayisePair(firstDate, secondDate) {
  const firstObserved = mondayise(firstDate);

  let secondObserved;
  const secondDow = dayOfWeek(secondDate);
  if (secondDow === 6) {
    secondObserved = addDays(secondDate, 2); // Sat -> Mon
  } else if (secondDow === 0) {
    secondObserved = addDays(secondDate, 1); // Sun -> Mon
  } else {
    secondObserved = secondDate;
  }

  // If both observed dates collide, push the second to the next day.
  if (formatDate(secondObserved) === formatDate(firstObserved)) {
    secondObserved = addDays(secondObserved, 1);
  }

  return [firstObserved, secondObserved];
}

/**
 * Anonymous Gregorian (Meeus/Jones/Butcher) algorithm for Easter Sunday.
 */
function calculateEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-based month
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return makeDate(year, month, day);
}

/** First Monday on/after a given date within the same month search window. */
function nthWeekdayOfMonth(year, month, weekday, n) {
  // month is 1-based; weekday: 0=Sun..6=Sat; n=1 for first, 4 for fourth, etc.
  const d = makeDate(year, month, 1);
  const firstWeekdayOffset = (weekday - dayOfWeek(d) + 7) % 7;
  const day = 1 + firstWeekdayOffset + (n - 1) * 7;
  return makeDate(year, month, day);
}

/** The Monday closest to a given month/day (used for Auckland/Wellington anniversaries). */
function mondayClosestTo(year, month, day) {
  const target = makeDate(year, month, day);
  const dow = dayOfWeek(target);
  let offset;
  if (dow === 1) {
    offset = 0;
  } else if (dow === 0) {
    offset = 1; // Sunday -> next day (Monday)
  } else if (dow <= 4) {
    // Tue(2), Wed(3), Thu(4) -> previous Monday is closer
    offset = -(dow - 1);
  } else {
    // Fri(5), Sat(6) -> next Monday is closer
    offset = 8 - dow;
  }
  return addDays(target, offset);
}

/**
 * Compute the regional anniversary day for the given year/region.
 * Returns a Date, or null if the region is unrecognised.
 */
function regionalAnniversary(year, region) {
  switch (region) {
    case 'hawkes-bay': {
      // Hawke's Bay Anniversary Day = the Friday before Labour Day.
      const labourDay = nthWeekdayOfMonth(year, 10, 1, 4);
      return addDays(labourDay, -3);
    }
    case 'auckland':
      // Monday closest to 29 January.
      return mondayClosestTo(year, 1, 29);
    case 'wellington':
      // Monday closest to 22 January.
      return mondayClosestTo(year, 1, 22);
    case 'canterbury': {
      // Show Day: second Friday after the first Tuesday of November.
      const firstTuesday = nthWeekdayOfMonth(year, 11, 2, 1);
      // First Friday after the first Tuesday...
      const firstFriday = addDays(firstTuesday, ((5 - dayOfWeek(firstTuesday) + 7) % 7) || 7);
      // ...then the second Friday after it.
      return addDays(firstFriday, 7);
    }
    default:
      return null;
  }
}

/**
 * Get all NZ public holidays observed in a given calendar year.
 *
 * @param {number} year
 * @param {{ region?: string }} [options]
 *   region: regional anniversary day to include. One of
 *   'hawkes-bay' (default), 'auckland', 'wellington', 'canterbury'.
 *   Any other value (or omission) yields no anniversary day.
 * @returns {string[]} sorted, deduplicated 'yyyy-MM-dd' date strings
 */
export function getNzHolidays(year, options = {}) {
  const { region = 'hawkes-bay' } = options;
  const dates = [];

  // New Year's Day / Day after New Year's Day (paired mondayisation)
  const [newYearsDay, dayAfterNewYears] = mondayisePair(
    makeDate(year, 1, 1),
    makeDate(year, 1, 2)
  );
  dates.push(newYearsDay, dayAfterNewYears);

  // Waitangi Day (mondayised, 2014+)
  dates.push(mondayise(makeDate(year, 2, 6)));

  // Good Friday / Easter Monday (never mondayised)
  const easterSunday = calculateEasterSunday(year);
  dates.push(addDays(easterSunday, -2)); // Good Friday
  dates.push(addDays(easterSunday, 1)); // Easter Monday

  // ANZAC Day (mondayised)
  dates.push(mondayise(makeDate(year, 4, 25)));

  // King's Birthday: first Monday of June
  dates.push(nthWeekdayOfMonth(year, 6, 1, 1));

  // Matariki: hardcoded Gazette dates, omitted if not tabulated
  if (MATARIKI_DATES[year]) {
    dates.push(new Date(`${MATARIKI_DATES[year]}T00:00:00`));
  }

  // Labour Day: fourth Monday of October
  dates.push(nthWeekdayOfMonth(year, 10, 1, 4));

  // Christmas Day / Boxing Day (paired mondayisation)
  const [christmasDay, boxingDay] = mondayisePair(
    makeDate(year, 12, 25),
    makeDate(year, 12, 26)
  );
  dates.push(christmasDay, boxingDay);

  // Regional anniversary day
  const anniversary = regionalAnniversary(year, region);
  if (anniversary) dates.push(anniversary);

  const dateStrings = dates.map(formatDate);
  return Array.from(new Set(dateStrings)).sort();
}

/**
 * Get NZ public holidays across an inclusive range of years.
 *
 * @param {number} startYear
 * @param {number} endYear
 * @param {{ region?: string }} [options]
 * @returns {string[]} sorted, deduplicated 'yyyy-MM-dd' date strings
 */
export function getNzHolidaysForRange(startYear, endYear, options = {}) {
  const all = [];
  for (let year = startYear; year <= endYear; year++) {
    all.push(...getNzHolidays(year, options));
  }
  return Array.from(new Set(all)).sort();
}

/**
 * Build a project working calendar, merging a programme's stored
 * calendar configuration with computed NZ public holidays.
 *
 * The returned shape is directly consumable by calendarEngine.js's
 * DEFAULT_CALENDAR shape ({ type, holidays, shutdowns }), plus an
 * hours_per_day field.
 *
 * @param {{ calendar?: object } | null | undefined} programme
 *   Row-like object with a `calendar` JSONB field (may include type,
 *   holidays[], shutdowns[], hours_per_day, region).
 * @param {number} startYear
 * @param {number} endYear
 * @returns {{ type: string, holidays: string[], shutdowns: Array<{start: string, end: string}>, hours_per_day: number }}
 */
export function buildProjectCalendar(programme, startYear, endYear) {
  if (!programme) {
    return {
      type: '5day',
      holidays: getNzHolidaysForRange(startYear, endYear, { region: 'hawkes-bay' }),
      shutdowns: [],
      hours_per_day: 8,
    };
  }

  const calendar = programme.calendar || {};
  const region = calendar.region || 'hawkes-bay';
  const generatedHolidays = getNzHolidaysForRange(startYear, endYear, { region });
  const manualHolidays = calendar.holidays || [];

  const holidays = Array.from(new Set([...generatedHolidays, ...manualHolidays])).sort();

  return {
    type: calendar.type || '5day',
    holidays,
    shutdowns: calendar.shutdowns || [],
    hours_per_day: calendar.hours_per_day || 8,
  };
}
