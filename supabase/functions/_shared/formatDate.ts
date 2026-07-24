/**
 * Shared date formatting for email bodies.
 *
 * Tender datetimes are stored as naive ISO strings with no timezone,
 * e.g. "2026-07-21T17:00:00". The edge runtime is UTC, so passing these
 * through `new Date(...)` + a Pacific/Auckland conversion would shift
 * 5:00 PM to 5:00 AM the next day. We parse the components by hand to
 * avoid any timezone drift — the display is exactly what was entered.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format a stored tender datetime as "Tuesday 21 July 2026, 5:00 PM".
 * Falls back to date-only when there is no time part, and to the raw
 * value if it cannot be parsed.
 */
export function formatClosingDateTime(val: string): string {
  if (!val) return '';
  const [datePart, timePart] = String(val).split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return val;

  // Date.UTC keeps the weekday calculation off the runtime timezone.
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const month = MONTHS[m - 1];
  let out = `${weekday} ${d} ${month} ${y}`;

  if (timePart) {
    const [hh, mm] = timePart.split(':').map(Number);
    if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
      const h12 = hh % 12 === 0 ? 12 : hh % 12;
      out += `, ${h12}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`;
    }
  }
  return out;
}
