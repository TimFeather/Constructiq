/**
 * Baseline Engine
 * Captures and compares schedule baselines
 */

/**
 * Capture a baseline snapshot from the current scheduled tasks.
 * Returns an array of baseline records.
 *
 * @param {Array} tasks - scheduled tasks with start_date, end_date, duration
 * @param {Map} scheduledMap - output of scheduleEngine (id → { startStr, finishStr, durationDays })
 * @returns {Array<{ task_id, baseline_start, baseline_finish, baseline_duration }>}
 */
export function captureBaseline(tasks, scheduledMap) {
  return tasks.map(task => {
    const resolved = scheduledMap?.get(task.id);
    return {
      task_id: task.id,
      baseline_start: resolved?.startStr || task.start_date,
      baseline_finish: resolved?.finishStr || task.end_date,
      baseline_duration: resolved?.durationDays || task.duration,
    };
  });
}

/**
 * Calculate variance between baseline and current schedule.
 *
 * @param {Object} baselineRecord - { baseline_start, baseline_finish, baseline_duration }
 * @param {Object} currentResolved - { startStr, finishStr, durationDays }
 * @returns {{ startVariance: number, finishVariance: number, durationVariance: number, status: string }}
 */
export function calculateVariance(baselineRecord, currentResolved) {
  if (!baselineRecord || !currentResolved) return null;

  const baseStart = baselineRecord.baseline_start ? new Date(baselineRecord.baseline_start) : null;
  const baseFinish = baselineRecord.baseline_finish ? new Date(baselineRecord.baseline_finish) : null;
  const curStart = currentResolved.startStr ? new Date(currentResolved.startStr) : null;
  const curFinish = currentResolved.finishStr ? new Date(currentResolved.finishStr) : null;

  const startVariance = baseStart && curStart
    ? Math.round((curStart - baseStart) / 86400000)
    : 0;

  const finishVariance = baseFinish && curFinish
    ? Math.round((curFinish - baseFinish) / 86400000)
    : 0;

  const durationVariance = (currentResolved.durationDays || 0) - (baselineRecord.baseline_duration || 0);

  let status = 'On Track';
  if (finishVariance > 0) status = `Delayed ${finishVariance}d`;
  else if (finishVariance < 0) status = `Ahead ${Math.abs(finishVariance)}d`;

  return { startVariance, finishVariance, durationVariance, status };
}

/**
 * Build a baseline lookup map from an array of baseline records.
 * Returns Map<task_id, baselineRecord>
 */
export function buildBaselineMap(baselineRecords) {
  const map = new Map();
  for (const record of (baselineRecords || [])) {
    map.set(record.task_id, record);
  }
  return map;
}