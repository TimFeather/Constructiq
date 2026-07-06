import { describe, it, expect } from 'vitest';
import { computeWBS, indentTask, outdentTask } from '../wbsUtils.js';

function applyPatches(tasks, patches) {
  const byId = new Map(patches.map(p => [p.id, p]));
  return tasks.map(t => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t));
}

function byId(tasks) {
  return new Map(tasks.map(t => [t.id, t]));
}

// A(1) -> [B(1.1), C(1.2), D(1.3)] where B has its own child B1(1.1.1)
function baseTree() {
  return [
    { id: 'A', parent_id: null, level: 1, sort_order: 1, wbs: '1' },
    { id: 'B', parent_id: 'A', level: 2, sort_order: 1, wbs: '1.1' },
    { id: 'B1', parent_id: 'B', level: 3, sort_order: 1, wbs: '1.1.1' },
    { id: 'C', parent_id: 'A', level: 2, sort_order: 2, wbs: '1.2' },
    { id: 'D', parent_id: 'A', level: 2, sort_order: 3, wbs: '1.3' },
  ];
}

describe('outdentTask', () => {
  it('promotes a mid-list child and turns following siblings into its children', () => {
    const tasks = baseTree();
    const patches = outdentTask('C', tasks);
    const patchMap = byId(patches);

    expect(patchMap.get('C').parent_id).toBe(null); // A's parent (root)
    expect(patchMap.get('C').level).toBe(1);
    expect(patchMap.get('D').parent_id).toBe('C');

    // B (preceding sibling) is untouched
    expect(patchMap.has('B')).toBe(false);
  });

  it('keeps existing children of the outdented task under it, with corrected depth', () => {
    // Outdent B instead — B1 should follow B up one level.
    const tasks = baseTree();
    const patches = outdentTask('B', tasks);
    const patchMap = byId(patches);

    expect(patchMap.get('B').parent_id).toBe(null);
    expect(patchMap.get('B').level).toBe(1);
    expect(patchMap.get('B1').parent_id).toBeUndefined(); // parent_id unchanged (still 'B')
    expect(patchMap.get('B1').level).toBe(2); // shifted up by one with B

    // C and D become B's children (they followed B in the original list)
    expect(patchMap.get('C').parent_id).toBe('B');
    expect(patchMap.get('D').parent_id).toBe('B');
  });

  it('is a no-op for a root-level task', () => {
    const tasks = baseTree();
    expect(outdentTask('A', tasks)).toEqual([]);
  });

  it('renumbers WBS after outdenting', () => {
    const tasks = baseTree();
    const patches = outdentTask('C', tasks);
    const updated = applyPatches(tasks, patches);
    const wbs = byId(computeWBS(updated));

    expect(wbs.get('A').wbs).toBe('1');
    expect(wbs.get('B').wbs).toBe('1.1');
    expect(wbs.get('C').wbs).toBe('2');
    expect(wbs.get('D').wbs).toBe('2.1');
  });
});

describe('indentTask', () => {
  it('is a no-op for the first sibling in a group', () => {
    const tasks = baseTree();
    expect(indentTask('B', tasks)).toEqual([]);
  });

  it('makes a task a child of its preceding sibling', () => {
    const tasks = baseTree();
    const patches = indentTask('C', tasks);
    const patchMap = byId(patches);

    expect(patchMap.get('C').parent_id).toBe('B');
    expect(patchMap.get('C').level).toBe(3); // one below B (level 2)
  });

  it('shifts the indented task\'s own subtree down a level', () => {
    // Give C a child C1, then indent C under B.
    const tasks = [...baseTree(), { id: 'C1', parent_id: 'C', level: 3, sort_order: 1 }];
    const patches = indentTask('C', tasks);
    const patchMap = byId(patches);

    expect(patchMap.get('C').level).toBe(3);
    expect(patchMap.get('C1').level).toBe(4);
  });

  it('renumbers WBS after indenting', () => {
    const tasks = baseTree();
    const patches = indentTask('C', tasks);
    const updated = applyPatches(tasks, patches);
    const wbs = byId(computeWBS(updated));

    // A's remaining direct children are B, then D (C moved under B)
    expect(wbs.get('B').wbs).toBe('1.1');
    expect(wbs.get('D').wbs).toBe('1.2');
    // Under B: B1 (existing child) then C (newly indented)
    expect(wbs.get('B1').wbs).toBe('1.1.1');
    expect(wbs.get('C').wbs).toBe('1.1.2');
  });
});
