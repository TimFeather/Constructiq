/**
 * Dependency Graph Engine
 * Builds and queries the task dependency network
 */

/**
 * Build a dependency graph from a task list.
 * Returns: { predecessors: Map<id, [{id, type, lagHours, isElapsed}]>,
 *            successors:   Map<id, [{id, type, lagHours, isElapsed}]> }
 */
export function buildDependencyGraph(tasks) {
  const predecessors = new Map();
  const successors = new Map();

  for (const task of tasks) {
    if (!predecessors.has(task.id)) predecessors.set(task.id, []);
    if (!successors.has(task.id)) successors.set(task.id, []);
  }

  for (const task of tasks) {
    for (const dep of (task.predecessors || [])) {
      if (dep.is_disabled) continue;
      const predId = dep.predecessor_id || dep.task_id;
      if (!predId) continue;

      const link = {
        id: predId,
        type: dep.type || 'FS',
        lagHours: dep.lag_hours ?? ((dep.lag_days ?? 0) * 8),
        isElapsed: dep.is_elapsed || false,
      };

      // Add to this task's predecessor list
      if (!predecessors.has(task.id)) predecessors.set(task.id, []);
      predecessors.get(task.id).push(link);

      // Add to predecessor's successor list
      if (!successors.has(predId)) successors.set(predId, []);
      successors.get(predId).push({
        id: task.id,
        type: dep.type || 'FS',
        lagHours: link.lagHours,
        isElapsed: link.isElapsed,
      });
    }
  }

  return { predecessors, successors };
}

/**
 * Get all predecessors of a task (direct)
 */
export function getPredecessors(taskId, graph) {
  return graph.predecessors.get(taskId) || [];
}

/**
 * Get all successors of a task (direct)
 */
export function getSuccessors(taskId, graph) {
  return graph.successors.get(taskId) || [];
}

/**
 * Get full dependency chain (all ancestors) of a task
 */
export function getDependencyChain(taskId, graph) {
  const chain = new Set();
  const stack = [taskId];
  while (stack.length) {
    const id = stack.pop();
    for (const pred of (graph.predecessors.get(id) || [])) {
      if (!chain.has(pred.id)) {
        chain.add(pred.id);
        stack.push(pred.id);
      }
    }
  }
  return chain;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns tasks in dependency order (predecessors before successors).
 */
export function topoSort(tasks, graph) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const inDegree = new Map(tasks.map(t => [t.id, 0]));

  for (const task of tasks) {
    for (const pred of (graph.predecessors.get(task.id) || [])) {
      if (taskMap.has(pred.id)) {
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
      }
    }
  }

  const queue = tasks.filter(t => (inDegree.get(t.id) || 0) === 0).map(t => t.id);
  const sorted = [];

  while (queue.length) {
    const id = queue.shift();
    const task = taskMap.get(id);
    if (task) sorted.push(task);

    for (const succ of (graph.successors.get(id) || [])) {
      const deg = (inDegree.get(succ.id) || 1) - 1;
      inDegree.set(succ.id, deg);
      if (deg === 0) queue.push(succ.id);
    }
  }

  // Append any remaining (shouldn't happen after cycle check)
  const sortedIds = new Set(sorted.map(t => t.id));
  for (const task of tasks) {
    if (!sortedIds.has(task.id)) sorted.push(task);
  }

  return sorted;
}

/**
 * True if `ancestorId` is an ancestor of `taskId` via parent_id links.
 * Guards against corrupt parent_id cycles with a visited set.
 */
export function isAncestorOf(tasks, ancestorId, taskId) {
  const parentOf = new Map(tasks.map(t => [t.id, t.parent_id ?? null]));
  const visited = new Set();
  let current = parentOf.get(taskId) ?? null;
  while (current != null) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

/**
 * Validate a proposed dependency link predecessorId → successorId.
 * Returns { ok: true } or { ok: false, reason: <string code> }.
 * Reason codes: 'self', 'missing-task', 'link-to-ancestor', 'link-to-descendant',
 *               'duplicate', 'cycle'.
 * `existingPredecessors` = the successor's predecessor array EXCLUDING the link being
 * added/edited (used for duplicate detection).
 */
export function validateLink(tasks, predecessorId, successorId, existingPredecessors = []) {
  if (predecessorId === successorId) {
    return { ok: false, reason: 'self' };
  }

  const taskMap = new Map(tasks.map(t => [t.id, t]));
  if (!taskMap.has(predecessorId) || !taskMap.has(successorId)) {
    return { ok: false, reason: 'missing-task' };
  }

  if (isAncestorOf(tasks, predecessorId, successorId)) {
    return { ok: false, reason: 'link-to-ancestor' };
  }

  if (isAncestorOf(tasks, successorId, predecessorId)) {
    return { ok: false, reason: 'link-to-descendant' };
  }

  const isDuplicate = existingPredecessors.some(p => (p.predecessor_id || p.task_id) === predecessorId);
  if (isDuplicate) {
    return { ok: false, reason: 'duplicate' };
  }

  if (wouldCreateCycle(tasks, predecessorId, successorId)) {
    return { ok: false, reason: 'cycle' };
  }

  return { ok: true };
}

/**
 * Detect circular dependencies using DFS.
 * Returns true if adding fromId → toId would create a cycle.
 */
export function wouldCreateCycle(tasks, fromId, toId) {
  // Build forward (successor) graph
  const forward = new Map(tasks.map(t => [t.id, []]));
  for (const task of tasks) {
    for (const dep of (task.predecessors || [])) {
      if (dep.is_disabled) continue;
      const pid = dep.predecessor_id || dep.task_id;
      if (!pid) continue;
      if (!forward.has(pid)) forward.set(pid, []);
      forward.get(pid).push(task.id);
    }
  }

  // Add the proposed new edge: fromId → toId
  if (!forward.has(fromId)) forward.set(fromId, []);
  forward.get(fromId).push(toId);

  // DFS from toId — if we reach fromId, it's a cycle
  const seen = new Set();
  const stack = [toId];
  while (stack.length) {
    const node = stack.pop();
    if (node === fromId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const succ of (forward.get(node) || [])) {
      stack.push(succ);
    }
  }
  return false;
}