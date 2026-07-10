import { describe, it, expect } from 'vitest';
import { buildDependencyGraph, topoSort, wouldCreateCycle, isAncestorOf, validateLink } from '../dependencyGraph.js';

function task(id, predIds = [], parentId = null) {
  return {
    id,
    parent_id: parentId,
    predecessors: predIds.map(p => ({ predecessor_id: p, type: 'FS', lag_hours: 0 })),
  };
}

describe('topoSort', () => {
  it('orders predecessors before successors', () => {
    const tasks = [task('C', ['B']), task('A'), task('B', ['A'])];
    const graph = buildDependencyGraph(tasks);
    const order = topoSort(tasks, graph).map(t => t.id);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
  });
});

describe('wouldCreateCycle', () => {
  const tasks = [task('A'), task('B', ['A']), task('C', ['B'])];

  it('rejects a direct back-link', () => {
    // C -> A when A ..-> C already exists
    expect(wouldCreateCycle(tasks, 'C', 'A')).toBe(true);
  });

  it('rejects an indirect cycle', () => {
    expect(wouldCreateCycle(tasks, 'B', 'A')).toBe(true);
  });

  it('allows a legitimate new link', () => {
    expect(wouldCreateCycle(tasks, 'A', 'C')).toBe(false);
  });
});

describe('isAncestorOf', () => {
  it('true for direct parent', () => {
    const tasks = [task('P'), task('C', [], 'P')];
    expect(isAncestorOf(tasks, 'P', 'C')).toBe(true);
  });

  it('true for grandparent', () => {
    const tasks = [task('GP'), task('P', [], 'GP'), task('C', [], 'P')];
    expect(isAncestorOf(tasks, 'GP', 'C')).toBe(true);
  });

  it('false for sibling', () => {
    const tasks = [task('P'), task('A', [], 'P'), task('B', [], 'P')];
    expect(isAncestorOf(tasks, 'A', 'B')).toBe(false);
  });

  it('false for self', () => {
    const tasks = [task('A')];
    expect(isAncestorOf(tasks, 'A', 'A')).toBe(false);
  });

  it('returns false (no hang) on a corrupt parent_id cycle', () => {
    const tasks = [task('A', [], 'B'), task('B', [], 'A')];
    expect(isAncestorOf(tasks, 'C', 'A')).toBe(false);
  });
});

describe('validateLink', () => {
  it('rejects self-links', () => {
    const tasks = [task('A')];
    expect(validateLink(tasks, 'A', 'A')).toEqual({ ok: false, reason: 'self' });
  });

  it('rejects linking a child to its parent (link-to-ancestor)', () => {
    const tasks = [task('P'), task('C', [], 'P')];
    expect(validateLink(tasks, 'P', 'C')).toEqual({ ok: false, reason: 'link-to-ancestor' });
  });

  it('rejects linking a child to its grandparent (link-to-ancestor)', () => {
    const tasks = [task('GP'), task('P', [], 'GP'), task('C', [], 'P')];
    expect(validateLink(tasks, 'GP', 'C')).toEqual({ ok: false, reason: 'link-to-ancestor' });
  });

  it('rejects a parent depending on its own child (link-to-descendant)', () => {
    const tasks = [task('P'), task('C', [], 'P')];
    expect(validateLink(tasks, 'C', 'P')).toEqual({ ok: false, reason: 'link-to-descendant' });
  });

  it('rejects a duplicate predecessor', () => {
    const tasks = [task('A'), task('B')];
    const existing = [{ predecessor_id: 'A', type: 'FS' }];
    expect(validateLink(tasks, 'A', 'B', existing)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('rejects a cycle', () => {
    const tasks = [task('A'), task('B', ['A']), task('C', ['B'])];
    expect(validateLink(tasks, 'C', 'A')).toEqual({ ok: false, reason: 'cycle' });
  });

  it('allows a valid link between unrelated leaves', () => {
    const tasks = [task('A'), task('B')];
    expect(validateLink(tasks, 'A', 'B')).toEqual({ ok: true });
  });
});

describe('disabled dependencies', () => {
  function taskWithDisabled(id, links) {
    return {
      id,
      predecessors: links.map(([p, disabled]) => ({ predecessor_id: p, type: 'FS', lag_hours: 0, is_disabled: disabled })),
    };
  }

  it('buildDependencyGraph yields no edge for a disabled link', () => {
    const tasks = [taskWithDisabled('A', []), taskWithDisabled('B', [['A', true]])];
    const graph = buildDependencyGraph(tasks);
    expect(getPredecessorsIds(graph, 'B')).toEqual([]);
    expect(getSuccessorsIds(graph, 'A')).toEqual([]);
  });

  it('wouldCreateCycle allows the reverse link when the existing one is disabled', () => {
    const tasks = [taskWithDisabled('A', []), taskWithDisabled('B', [['A', true]])];
    expect(wouldCreateCycle(tasks, 'B', 'A')).toBe(false);
  });

  it('validateLink still flags a duplicate when the existing link is disabled', () => {
    const tasks = [taskWithDisabled('A', []), taskWithDisabled('B', [])];
    const existing = [{ predecessor_id: 'A', type: 'FS', is_disabled: true }];
    expect(validateLink(tasks, 'A', 'B', existing)).toEqual({ ok: false, reason: 'duplicate' });
  });
});

function getPredecessorsIds(graph, id) {
  return (graph.predecessors.get(id) || []).map(p => p.id);
}
function getSuccessorsIds(graph, id) {
  return (graph.successors.get(id) || []).map(s => s.id);
}
