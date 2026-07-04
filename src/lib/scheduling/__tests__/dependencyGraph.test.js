import { describe, it, expect } from 'vitest';
import { buildDependencyGraph, topoSort, wouldCreateCycle } from '../dependencyGraph.js';

function task(id, predIds = []) {
  return {
    id,
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
