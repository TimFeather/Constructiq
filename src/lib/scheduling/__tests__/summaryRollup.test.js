import { describe, it, expect } from 'vitest';
import { runScheduleEngine } from '../scheduleEngine.js';

const CAL = { type: '5day', holidays: [], shutdowns: [] };

// 2026-01-05 is a Monday.
const leaf = (id, parent_id, duration, percent_complete, start_date = '2026-01-05') => ({
  id, project_id: 'p1', name: id, parent_id, start_date, end_date: start_date,
  duration, percent_complete, predecessors: [], constraint: null,
});
// Stored summary % is stale on purpose: nothing keeps that column current.
const summary = (id, parent_id = null) => ({
  id, project_id: 'p1', name: id, parent_id, start_date: '2026-01-05', end_date: '2026-01-05',
  duration: 1, percent_complete: 0, predecessors: [], constraint: null,
});

const run = (tasks) => runScheduleEngine(tasks, '2026-01-05', CAL);

describe('summary progress rollup', () => {
  it('weights a one-level summary by child duration', () => {
    const r = run([
      summary('S'),
      leaf('a', 'S', 3, 100),
      leaf('b', 'S', 1, 0),
    ]);
    expect(r.get('S').rolledProgress).toBe(75);
  });

  it('rolls a nested summary up from the leaves, not the child summary’s stored %', () => {
    // Ali Burrows shape: a job summary over phase summaries, all work done.
    const r = run([
      summary('JOB'),
      summary('P1', 'JOB'),
      leaf('a', 'P1', 2, 100),
      leaf('b', 'P1', 1, 100),
      summary('P2', 'JOB'),
      leaf('c', 'P2', 3, 100),
    ]);
    expect(r.get('P1').rolledProgress).toBe(100);
    expect(r.get('P2').rolledProgress).toBe(100);
    expect(r.get('JOB').rolledProgress).toBe(100);
  });

  it('weights every leaf by its duration across levels', () => {
    const r = run([
      summary('JOB'),
      summary('P1', 'JOB'),
      leaf('a', 'P1', 6, 100),
      leaf('x', 'JOB', 2, 0),
      summary('P2', 'JOB'),
      leaf('c', 'P2', 1, 100),
      leaf('d', 'P2', 1, 0),
    ]);
    // 6 + 1 of 10 leaf days done → 70%. (Averaging JOB's children by their own
    // stored durations would give 37.5%; the old stored-% rollup gave 0%.)
    expect(r.get('P2').rolledProgress).toBe(50);
    expect(r.get('JOB').rolledProgress).toBe(70);
  });

  it('three levels deep', () => {
    const r = run([
      summary('A'),
      summary('B', 'A'),
      summary('C', 'B'),
      leaf('l1', 'C', 1, 100),
      leaf('l2', 'B', 3, 0),
    ]);
    expect(r.get('C').rolledProgress).toBe(100);
    expect(r.get('B').rolledProgress).toBe(25);
    expect(r.get('A').rolledProgress).toBe(25);
  });
});
