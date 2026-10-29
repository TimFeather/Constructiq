/**
 * Working-day durations come in halves and quarters (MS Project's 4h task is
 * 0.5d), so editors must keep fractions rather than round to whole days.
 *
 * @returns {number} a positive duration rounded to 2 decimals, or `fallback`
 *   when the value isn't a positive number
 */
export function normalizeDuration(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n * 100) / 100;
}
