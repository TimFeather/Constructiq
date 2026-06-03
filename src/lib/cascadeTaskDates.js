import { computeCascade } from './scheduling/scheduleEngine.js';

/**
 * After a task's dates/duration change, run the scheduling engine
 * to compute all downstream patches and apply them to the database.
 *
 * @param {string} changedTaskId
 * @param {Array} allTasks - task list already containing the updated task data
 * @param {Function} updateFn - async (id, data) => void
 * @param {string} [projectStartDate] - fallback ASAP anchor date
 */
export async function cascadeTaskDates(changedTaskId, allTasks, updateFn, projectStartDate) {
  const patches = computeCascade(changedTaskId, allTasks, projectStartDate);

  // Only patch tasks that still exist in the provided task list
  const existingIds = new Set(allTasks.map(t => t.id));

  for (const patch of patches) {
    if (!existingIds.has(patch.id)) continue;
    await updateFn(patch.id, {
      start_date: patch.start_date,
      end_date: patch.end_date,
      duration: patch.duration,
    });
  }
}