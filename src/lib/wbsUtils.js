/**
 * WBS Utilities
 * Auto-numbering and indent/outdent operations
 */

/**
 * Recompute WBS numbers for all tasks in a project.
 * Returns an array of { id, wbs } patches.
 * WBS is computed from the parent/child hierarchy in sort_order order.
 */
export function computeWBS(tasks) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const patches = [];

  // Build parent→children map, sorted by sort_order
  const childrenOf = new Map();
  for (const task of tasks) {
    const pid = task.parent_id || null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(task);
  }
  for (const [, children] of childrenOf) {
    children.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  const assign = (parentId, prefix) => {
    const children = childrenOf.get(parentId) || [];
    children.forEach((task, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      patches.push({ id: task.id, wbs });
      assign(task.id, wbs);
    });
  };

  assign(null, '');
  return patches;
}

/**
 * Indent a task — make it a child of its nearest preceding sibling.
 * Returns patches: array of { id, parent_id, level, wbs }
 */
export function indentTask(taskId, tasks) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return [];

  // Find siblings (same parent) sorted by sort_order
  const siblings = tasks
    .filter(t => t.parent_id === (task.parent_id || null) && t.id !== taskId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Preceding sibling
  const precedingSibling = siblings
    .filter(s => (s.sort_order || 0) < (task.sort_order || 0))
    .pop();

  if (!precedingSibling) return []; // Can't indent — no preceding sibling

  const newLevel = Math.min((precedingSibling.level || 0) + 1, 3);
  const patch = { id: taskId, parent_id: precedingSibling.id, level: newLevel };

  // Re-WBS
  const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, ...patch } : t);
  const wbsPatches = computeWBS(updatedTasks);
  const wbsPatch = wbsPatches.find(p => p.id === taskId);

  return [{ ...patch, wbs: wbsPatch?.wbs || task.wbs }];
}

/**
 * Outdent a task — move it to the parent's level (sibling of its current parent).
 * Returns patches: array of { id, parent_id, level, wbs }
 */
export function outdentTask(taskId, tasks) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.parent_id) return []; // Already at root

  const parent = tasks.find(t => t.id === task.parent_id);
  if (!parent) return [];

  const newParentId = parent.parent_id || null;
  const newLevel = Math.max((task.level || 0) - 1, 0);
  const newSortOrder = (parent.sort_order || 0) + 0.5; // Place after parent

  const patch = { id: taskId, parent_id: newParentId, level: newLevel, sort_order: newSortOrder };

  const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, ...patch } : t);
  const wbsPatches = computeWBS(updatedTasks);
  const wbsPatch = wbsPatches.find(p => p.id === taskId);

  return [{ ...patch, wbs: wbsPatch?.wbs || task.wbs }];
}