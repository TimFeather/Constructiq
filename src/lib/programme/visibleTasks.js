/**
 * Single source of truth for visible task ordering.
 * Both TaskList and GanttChart must use this function.
 */
export function getVisibleTasks(tasks, expandedIds) {
  const wbsCompare = (a, b) => {
    const parse = (w) => (w || '').split('.').map(n => parseInt(n) || 0);
    const ap = parse(a.wbs), bp = parse(b.wbs);
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      const diff = (ap[i] || 0) - (bp[i] || 0);
      if (diff !== 0) return diff;
    }
    return (a.sort_order || 0) - (b.sort_order || 0);
  };

  const result = [];

  const addTask = (task) => {
    result.push(task);
    if (expandedIds.has(task.id)) {
      tasks
        .filter(t => t.parent_id === task.id)
        .sort(wbsCompare)
        .forEach(addTask);
    }
  };

  tasks
    .filter(t => !t.parent_id)
    .sort(wbsCompare)
    .forEach(addTask);

  return result;
}