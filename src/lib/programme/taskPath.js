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

/**
 * Map of task id → "UNIT 8 › STRUCTURE" for every task with groups above it,
 * so a list of bare task names (the Look Ahead on a phone) still says which
 * building each one belongs to.
 *
 * Most programmes wrap the whole outline in one top-level group named after
 * the job ("Kainga Ora - Template", "BUILD SCHEDULE"). It sits above every
 * task, so it says nothing about where a task is — when a project has exactly
 * one top-level group, that group is left out. Loose top-level tasks (a
 * milestone outside the wrapper) don't count as groups.
 */
export function groupPathLabels(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const parentIds = new Set(tasks.map(t => t.parent_id).filter(Boolean));
  const topGroups = new Map(); // project_id → number of top-level groups
  for (const t of tasks) {
    if (!t.parent_id && parentIds.has(t.id)) {
      topGroups.set(t.project_id, (topGroups.get(t.project_id) || 0) + 1);
    }
  }

  const labels = new Map();
  for (const t of tasks) {
    let chain = taskAncestors(t, byId);
    // chain[0] is only the true top when its own parent_id is empty — a broken
    // chain (parent not loaded) keeps everything it found.
    if (chain.length && !chain[0].parent_id && topGroups.get(chain[0].project_id) === 1) {
      chain = chain.slice(1);
    }
    const label = chain.map(a => a.name).filter(Boolean).join(' › ');
    if (label) labels.set(t.id, label);
  }
  return labels;
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
