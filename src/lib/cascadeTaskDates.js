import { addDays, differenceInCalendarDays } from 'date-fns';

/**
 * Given a task that just changed its end_date, cascade date shifts
 * to all successor tasks (tasks that have this task as a predecessor).
 * Recurses through the chain.
 *
 * @param {string} changedTaskId - the task whose end_date changed
 * @param {string} newEndDate - the new end date (yyyy-MM-dd)
 * @param {Array} allTasks - full task list
 * @param {Function} updateFn - async (id, data) => void
 */
export async function cascadeTaskDates(changedTaskId, newEndDate, allTasks, updateFn) {
  // Find all tasks that have changedTaskId as a predecessor
  const successors = allTasks.filter(t =>
    (t.predecessors || []).some(p => p.task_id === changedTaskId)
  );

  for (const successor of successors) {
    // Find the latest end date across all its predecessors
    let latestEnd = null;
    for (const pred of successor.predecessors || []) {
      const predTask = allTasks.find(t => t.id === pred.task_id);
      // Use the updated end date for the changed task
      const predEndDate = pred.task_id === changedTaskId ? newEndDate : predTask?.end_date;
      if (!predEndDate) continue;
      const endPlusLag = addDays(new Date(predEndDate), (pred.lag_days || 0) + 1);
      if (!latestEnd || endPlusLag > latestEnd) latestEnd = endPlusLag;
    }

    if (!latestEnd) continue;

    const newStart = latestEnd.toISOString().split('T')[0];
    const duration = successor.duration || 1;
    const newEnd = addDays(latestEnd, duration - 1).toISOString().split('T')[0];

    // Only update if dates actually changed
    if (newStart !== successor.start_date || newEnd !== successor.end_date) {
      await updateFn(successor.id, { start_date: newStart, end_date: newEnd });
      // Recurse: this successor's end date changed, so cascade further
      await cascadeTaskDates(successor.id, newEnd, allTasks, updateFn);
    }
  }
}