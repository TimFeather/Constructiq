import { computeCascade } from './schedulingEngine';

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

  // Apply all patches in parallel
  await Promise.all(patches.map(patch =>
    updateFn(patch.id, {
      start_date: patch.start_date,
      end_date: patch.end_date,
      duration: patch.duration,
    })
  ));
}