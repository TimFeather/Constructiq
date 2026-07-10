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
