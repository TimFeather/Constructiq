/**
 * Native task creation — shared by AddTaskDialog and the task table's
 * inline "Add task…" ghost row. Creates the task, optionally links a
 * predecessor through the scheduling service, then renumbers WBS for any
 * task whose position shifted because of the insert.
 */
import { Task } from '@/api/entities';
import { updateTaskDependency } from '@/lib/scheduleUpdateService';
import { bulkUpdateTaskWbs } from '@/api/programmeData';
import { computeWBS } from '@/lib/wbsUtils';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Where to place a new task in its group's sort order.
 * Anchor = the predecessor, if it lives in the same parent group as the
 * chosen parent — the new task lands directly below it (fractional
 * sort_order, midpoint to the next sibling). Otherwise it's appended as the
 * last child of the chosen parent (or top-level if no parent).
 */
function computeSortOrder(tasks, parentId, predecessorId) {
  const predecessor = predecessorId ? tasks.find(t => t.id === predecessorId) : null;
  const groupSiblings = tasks.filter(t => (t.parent_id || null) === (parentId || null));

  if (predecessor && (predecessor.parent_id || null) === (parentId || null)) {
    const sorted = groupSiblings.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const idx = sorted.findIndex(t => t.id === predecessor.id);
    const next = sorted[idx + 1];
    return next
      ? ((predecessor.sort_order || 0) + (next.sort_order || 0)) / 2
      : (predecessor.sort_order || 0) + 1;
  }

  const maxSort = groupSiblings.reduce((m, t) => Math.max(m, Number(t.sort_order) || 0), 0);
  return maxSort + 1;
}

// Positional insert beside an existing row (context-menu "Insert Above" /
// "Insert Below") — same group as the anchor task, no dependency link.
function computeAnchorSortOrder(tasks, anchorTask, position) {
  const groupSiblings = tasks
    .filter(t => (t.parent_id || null) === (anchorTask.parent_id || null))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const idx = groupSiblings.findIndex(t => t.id === anchorTask.id);

  if (position === 'above') {
    const prev = groupSiblings[idx - 1];
    return prev
      ? ((prev.sort_order || 0) + (anchorTask.sort_order || 0)) / 2
      : (anchorTask.sort_order || 0) - 1;
  }

  const next = groupSiblings[idx + 1];
  return next
    ? ((anchorTask.sort_order || 0) + (next.sort_order || 0)) / 2
    : (anchorTask.sort_order || 0) + 1;
}

/**
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.name
 * @param {Array} opts.tasks — current task list (used for sort/WBS placement)
 * @param {object} opts.scheduleOptions — passed through to updateTaskDependency
 * @param {string|null} [opts.parentId] — WBS group; null = top level
 * @param {string|null} [opts.predecessorId]
 * @param {string} [opts.depType] — FS/SS/FF/SF, only used with predecessorId
 * @param {number} [opts.lagDays]
 * @param {number} [opts.duration] — working days; ignored for milestones
 * @param {boolean} [opts.isMilestone]
 * @param {string|null} [opts.startDate] — yyyy-MM-dd; defaults to data date / today
 * @param {{task: object, position: 'above'|'below'}|null} [opts.anchor] — positional
 *   insert beside an existing row (context-menu Insert Above/Below); lands in the
 *   anchor's own group. Takes precedence over parentId/predecessorId placement and
 *   never creates a dependency link.
 * @returns {Promise<object>} the created task record
 */
export async function createTaskInline({
  projectId, name, tasks, scheduleOptions,
  parentId = null, predecessorId = null, depType = 'FS', lagDays = 0,
  duration = 5, isMilestone = false, startDate = null, anchor = null,
}) {
  const effectiveParentId = anchor ? (anchor.task.parent_id || null) : parentId;
  const parent = effectiveParentId ? tasks.find(t => t.id === effectiveParentId) : null;
  const sortOrder = anchor
    ? computeAnchorSortOrder(tasks, anchor.task, anchor.position)
    : computeSortOrder(tasks, parentId, predecessorId);

  const created = await Task.create({
    project_id: projectId,
    name: name.trim(),
    duration: isMilestone ? 0 : Math.max(1, Number(duration) || 1),
    is_milestone: isMilestone,
    start_date: startDate || scheduleOptions?.dataDate || todayStr(),
    end_date: null,
    parent_id: effectiveParentId,
    level: parent ? Math.min((parent.level ?? 1) + 1, 3) : 1,
    sort_order: sortOrder,
    percent_complete: 0,
    task_status: 'Not Started',
  });

  // Optional predecessor: link via the service so the engine places the
  // new task (and cascades) immediately.
  if (predecessorId && created?.id) {
    const lagDaysNum = Number(lagDays) || 0;
    const allTasks = [...tasks, { ...created, predecessors: [] }];
    await updateTaskDependency(created.id, [{
      predecessor_id: predecessorId, type: depType || 'FS',
      lag_days: lagDaysNum, lag_hours: lagDaysNum * 8, is_elapsed: false,
    }], allTasks, scheduleOptions);
  }

  // WBS renumber cascade: visibleTasks sorts by WBS before sort_order, so
  // an unnumbered insert would otherwise sort to the top of its group.
  if (created?.id) {
    const postInsertTasks = [...tasks, created];
    const wbsPatches = computeWBS(postInsertTasks).filter(p => {
      const t = postInsertTasks.find(x => x.id === p.id);
      return t?.wbs !== p.wbs;
    });
    if (wbsPatches.length) {
      await bulkUpdateTaskWbs(wbsPatches);
    }
  }

  return created;
}
