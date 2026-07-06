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
 * Depth-walk the descendants of `rootId` (using current parent_id links in
 * `tasks`) and return { id, level } patches for any descendant whose stored
 * level no longer matches its actual depth below the root. Used after an
 * indent/outdent shifts a subtree up or down one level.
 */
function subtreeLevelPatches(tasks, rootId) {
  const childrenOf = new Map();
  for (const t of tasks) {
    const pid = t.parent_id || null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(t);
  }
  const root = tasks.find(t => t.id === rootId);
  if (!root) return [];

  const patches = [];
  const walk = (node, level) => {
    if ((node.level || 0) !== level) patches.push({ id: node.id, level });
    const kids = childrenOf.get(node.id) || [];
    kids.forEach(k => walk(k, level + 1));
  };
  const kids = childrenOf.get(root.id) || [];
  kids.forEach(k => walk(k, root.level + 1));
  return patches;
}

// Apply a list of partial patches ({ id, ...fields }) onto a task list,
// returning a new array (unmatched tasks pass through unchanged).
function applyPatches(tasks, patches) {
  if (!patches.length) return tasks;
  const byId = new Map(patches.map(p => [p.id, p]));
  return tasks.map(t => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t));
}

// Merge two patch arrays (each { id, ...fields }) into one, keyed by id —
// fields from `extra` win on conflict, other fields from `base` are kept.
function mergePatches(base, extra) {
  const map = new Map(base.map(p => [p.id, { ...p }]));
  for (const p of extra) {
    map.set(p.id, { ...(map.get(p.id) || { id: p.id }), ...p });
  }
  return [...map.values()];
}

/**
 * Indent a task — make it a child of its nearest preceding sibling.
 * Returns patches: array of { id, parent_id?, level, sort_order?, wbs? }
 * covering the moved task, any descendants whose depth shifted, and any
 * task whose WBS number changed as a result.
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

  let updatedTasks = tasks.map(t => (t.id === taskId
    ? { ...t, parent_id: precedingSibling.id, level: newLevel }
    : t));

  const levelPatches = subtreeLevelPatches(updatedTasks, taskId);
  updatedTasks = applyPatches(updatedTasks, levelPatches);

  const wbsPatches = computeWBS(updatedTasks).filter(p => {
    const t = updatedTasks.find(x => x.id === p.id);
    return t?.wbs !== p.wbs;
  });

  let patches = mergePatches(
    [{ id: taskId, parent_id: precedingSibling.id, level: newLevel }],
    levelPatches,
  );
  patches = mergePatches(patches, wbsPatches);
  return patches;
}

/**
 * Outdent a task — promote it to its parent's level (sibling of its current
 * parent). MS Project semantics: following siblings of the outdented task
 * (within its old parent group) become its children.
 * Returns patches: array of { id, parent_id?, level, sort_order?, wbs? }.
 */
export function outdentTask(taskId, tasks) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.parent_id) return []; // Already at root

  const parent = tasks.find(t => t.id === task.parent_id);
  if (!parent) return [];

  const newParentId = parent.parent_id || null;
  const newLevel = Math.max((task.level || 0) - 1, 0);
  const newSortOrder = (parent.sort_order || 0) + 0.5; // Place after parent

  // Former siblings that followed X (same parent, later sort_order) become
  // X's children — they keep their own level/sort_order (they're now one
  // level below X, same as before X moved up).
  const followingSiblings = tasks.filter(t => t.parent_id === task.parent_id
    && t.id !== taskId
    && (t.sort_order || 0) > (task.sort_order || 0));

  let updatedTasks = tasks.map(t => {
    if (t.id === taskId) return { ...t, parent_id: newParentId, level: newLevel, sort_order: newSortOrder };
    if (followingSiblings.some(s => s.id === t.id)) return { ...t, parent_id: taskId };
    return t;
  });

  const levelPatches = subtreeLevelPatches(updatedTasks, taskId);
  updatedTasks = applyPatches(updatedTasks, levelPatches);

  const wbsPatches = computeWBS(updatedTasks).filter(p => {
    const t = updatedTasks.find(x => x.id === p.id);
    return t?.wbs !== p.wbs;
  });

  let patches = mergePatches(
    [{ id: taskId, parent_id: newParentId, level: newLevel, sort_order: newSortOrder }],
    followingSiblings.map(s => ({ id: s.id, parent_id: taskId })),
  );
  patches = mergePatches(patches, levelPatches);
  patches = mergePatches(patches, wbsPatches);
  return patches;
}
