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
  while (!isWorkingDay(d, calendar)) {
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
  while (!isWorkingDay(d, calendar)) {
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

  while (remaining > 0) {
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