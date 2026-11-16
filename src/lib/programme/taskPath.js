/**
 * Where a task sits in the outline — used wherever a task is picked or
 * announced by name, because imported programmes repeat group names
 * ("UNITS 6 & 7", "EXTERIOR ENVELOPE") under different parents.
 */

/** Ancestors of a task, outermost first (excludes the task itself). */
export function taskAncestors(task, tasksById) {
  const chain = [];
  const seen = new Set();
  let parentId = task?.parent_id || null;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = tasksById.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parent_id || null;
  }
  return chain;
}

/** "SITE WORKS - INTERNAL › UNITS 6 & 7" — the groups a task sits under. */
export function taskPathLabel(task, tasksById) {
  return taskAncestors(task, tasksById).map(t => t.name).join(' › ');
}

const parseWbs = (w) => (w || '').split('.').map(n => parseInt(n, 10) || 0);

/** Tasks in outline (WBS) order, falling back to sort_order for ties. */
export function inOutlineOrder(tasks) {
  return tasks
    .map(t => ({ t, key: parseWbs(t.wbs) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
        const diff = (a.key[i] || 0) - (b.key[i] || 0);
        if (diff !== 0) return diff;
      }
      return (a.t.sort_order || 0) - (b.t.sort_order || 0);
    })
    .map(x => x.t);
}
