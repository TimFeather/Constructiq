import { describe, it, expect, vi, beforeEach } from 'vitest';

const tables = {};
const errors = {};

// Minimal PostgREST stand-in: caps every response at 1000 rows like the real one.
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from(table) {
      const query = {
        select: () => query,
        order: () => query,
        eq(col, val) { query.filters.push(r => r[col] === val); return query; },
        range(from, to) { query.bounds = [from, to]; return query; },
        filters: [],
        then(resolve) {
          if (errors[table]) return resolve({ data: null, error: errors[table], count: null });
          const rows = tables[table].filter(r => query.filters.every(f => f(r)));
          const [from, to] = query.bounds;
          resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null, count: rows.length });
        },
      };
      return query;
    },
  },
}));

vi.mock('@/api/entities', () => ({ Programme: {}, Task: {}, TaskDependency: {} }));

const { fetchProgrammeTasks, programmeTasksQuery } = await import('@/api/programmeData');

const makeTasks = (n, project_id = 'p1') =>
  Array.from({ length: n }, (_, i) => ({ id: `${project_id}-t${i}`, project_id, sort_order: i }));

beforeEach(() => {
  tables.tasks = [];
  tables.task_dependencies = [];
  delete errors.tasks;
  delete errors.task_dependencies;
});

describe('fetchProgrammeTasks', () => {
  it('returns every task and link past the 1000-row response cap', async () => {
    tables.tasks = makeTasks(2500);
    tables.task_dependencies = tables.tasks.slice(1).map((t, i) => ({
      id: `d${i}`, project_id: 'p1', successor_task_id: t.id, predecessor_task_id: tables.tasks[i].id,
    }));

    const tasks = await fetchProgrammeTasks('all');

    expect(tasks).toHaveLength(2500);
    expect(tasks[2499].predecessors[0].predecessor_id).toBe('p1-t2498');
  });

  it('only returns the requested project', async () => {
    tables.tasks = [...makeTasks(3, 'p1'), ...makeTasks(2, 'p2')];

    expect(await fetchProgrammeTasks('p2')).toHaveLength(2);
  });

  it('maps constraint_data onto constraint', async () => {
    tables.tasks = [{ ...makeTasks(1)[0], constraint_data: { type: 'SNET', date: '2026-11-03' } }];

    const [task] = await fetchProgrammeTasks('p1');

    expect(task.constraint).toEqual({ type: 'SNET', date: '2026-11-03' });
    expect(task.predecessors).toEqual([]);
  });

  it('throws rather than returning tasks without their links', async () => {
    tables.tasks = makeTasks(3);
    errors.task_dependencies = new Error('timeout');

    await expect(fetchProgrammeTasks('p1')).rejects.toThrow('timeout');
  });
});

describe('programmeTasksQuery', () => {
  it('keys on the project so all screens share one cache entry', () => {
    expect(programmeTasksQuery('p1').queryKey).toEqual(['tasks', 'p1']);
  });
});
