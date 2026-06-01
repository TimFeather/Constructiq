/**
 * Flattens a hierarchical task tree into a display-order array.
 * Both TaskList and GanttChart use this to ensure row alignment.
 */
function wbsCompare(a, b) {
  const parseWbs = (wbs) => (wbs || '').split('.').map(n => parseInt(n) || 0);
  const aParts = parseWbs(a.wbs);
  const bParts = parseWbs(b.wbs);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) return diff;
  }
  return (a.sort_order || 0) - (b.sort_order || 0);
}

export function flattenTasks(tasks) {
  const result = [];
  const rootTasks = tasks.filter(t => !t.parent_id).sort(wbsCompare);
  
  const addTask = (task) => {
    result.push(task);
    const children = tasks.filter(t => t.parent_id === task.id).sort(wbsCompare);
    children.forEach(addTask);
  };
  
  rootTasks.forEach(addTask);
  return result;
}