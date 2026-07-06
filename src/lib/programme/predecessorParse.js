/**
 * Parse a typed predecessor string (e.g. "1.2FS+2d, 3.1SS-1d, 5") into
 * engine-shape predecessor objects, resolving WBS numbers against a
 * task.wbs -> task.id map.
 *
 * Grammar per entry (case-insensitive type, whitespace tolerant):
 *   <wbs>[<FS|SS|FF|SF>][<+|-><lag>[d]]
 * Type defaults to FS, lag defaults to 0.
 */

const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];
const ENTRY_RE = /^([0-9]+(?:\.[0-9]+)*)\s*(fs|ss|ff|sf)?\s*([+-]\s*[0-9]+)?\s*d?$/i;

/**
 * @param {string} input - raw text typed by the user
 * @param {Map<string,string>} wbsToId - task.wbs -> task.id
 * @returns {{ preds: Array<{predecessor_id, type, lag_days, lag_hours, is_elapsed}>, errors: string[] }}
 */
export function parsePredecessorInput(input, wbsToId) {
  const trimmed = (input || '').trim();
  if (!trimmed) return { preds: [], errors: [] };

  const tokens = trimmed.split(/[,;]/).map(t => t.trim()).filter(Boolean);
  const preds = [];
  const errors = [];

  for (const token of tokens) {
    const match = ENTRY_RE.exec(token);
    if (!match) {
      errors.push(`"${token}" isn't a valid predecessor (expected e.g. 1.2FS+2d)`);
      continue;
    }
    const [, wbs, typeRaw, lagRaw] = match;
    const predecessorId = wbsToId.get(wbs);
    if (!predecessorId) {
      errors.push(`No task with WBS "${wbs}"`);
      continue;
    }
    const type = typeRaw ? typeRaw.toUpperCase() : 'FS';
    if (!DEP_TYPES.includes(type)) {
      errors.push(`"${token}" has an invalid dependency type`);
      continue;
    }
    const lagDays = lagRaw ? parseInt(lagRaw.replace(/\s+/g, ''), 10) : 0;
    preds.push({
      predecessor_id: predecessorId,
      type,
      lag_days: lagDays,
      lag_hours: lagDays * 8,
      is_elapsed: false,
    });
  }

  return { preds, errors };
}
