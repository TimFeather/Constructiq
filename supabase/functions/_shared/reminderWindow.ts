/**
 * Shared date-window math for the reminder engine.
 *
 * The edge runtime's clock is UTC. `closing_date` / `questions_date` are
 * naive NZ wall-clock strings with no timezone, e.g. "2026-08-26T17:00:00"
 * (see `formatDate.ts` for the same problem on the display side). Comparing
 * "today" (a real UTC instant) against that string needs today's date
 * converted *into* NZ first — never the reverse, and never by pushing the
 * naive string through `new Date()`, which the runtime would reinterpret as
 * UTC and shift by 12-13 hours.
 *
 * At the recommended 19:00 UTC cron slot it is already tomorrow in NZ, so
 * skipping the NZ conversion makes every "days until" answer read one
 * higher than reality. `nzToday` fixes the "today" side of that comparison;
 * `daysUntilNZ` does the whole-day subtraction on calendar dates only, with
 * no time-of-day component, so a 5pm closing and a 9am closing on the same
 * date both count as 0 days away on the day itself.
 */

/** Today's date in NZ as 'YYYY-MM-DD', correct across NZST/NZDT. */
export function nzToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD; Intl resolves the NZST/NZDT offset for the
  // given instant, so DST is the runtime's problem, not a hardcoded +12/+13.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

function parseDateParts(dateOnly: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

/**
 * Whole days from today (NZ) to a stored tender datetime, comparing calendar
 * dates only. `closing_date` is naive NZ wall-clock ("2026-08-26T17:00:00"),
 * so the date part is taken as-is — never through `new Date()`, which would
 * reinterpret it in the runtime timezone.
 * Returns null if unparseable.
 */
export function daysUntilNZ(stored: string, now?: Date): number | null {
  if (!stored) return null;
  const datePart = String(stored).split('T')[0];
  const target = parseDateParts(datePart);
  if (!target) return null;
  const [ty, tmo, td] = target;

  const todayParts = parseDateParts(nzToday(now));
  if (!todayParts) return null;
  const [cy, cmo, cd] = todayParts;

  // Date.UTC on two plain Y-M-D triples gives an exact whole-day difference
  // with no DST arithmetic — both sides are calendar dates, not instants.
  const targetUTC = Date.UTC(ty, tmo - 1, td);
  const todayUTC = Date.UTC(cy, cmo - 1, cd);
  return Math.round((targetUTC - todayUTC) / (1000 * 60 * 60 * 24));
}
