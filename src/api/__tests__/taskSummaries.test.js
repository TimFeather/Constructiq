import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

let rows = [];
let failFrom = null;
const selected = [];

// Minimal PostgREST stand-in: caps every response at 1000 rows like the real one.
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from() {
      const query = {
        select(columns) { selected.push(columns); return query; },
        order: () => query,
        range(from, to) { query.bounds = [from, to]; return query; },
        then(resolve) {
          const [from, to] = query.bounds;
          if (failFrom !== null && from >= failFrom) return resolve({ data: null, error: new Error('timeout'), count: null });
          resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null, count: rows.length });
        },
      };
      return query;
    },
  },
}));

const { fetchTaskSummaries, taskSummariesQuery } = await import('@/api/taskSummaries');

const makeTasks = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, project_id: 'p1' }));

beforeEach(() => {
  rows = [];
  failFrom = null;
  selected.length = 0;
});

describe('fetchTaskSummaries', () => {
  it('returns every task past the 1000-row response cap', async () => {
    rows = makeTasks(1376);

    const tasks = await fetchTaskSummaries();

    expect(tasks).toHaveLength(1376);
    expect(new Set(tasks.map(t => t.id)).size).toBe(1376);
  });

  it('returns nothing, not an error, when there are no tasks', async () => {
    expect(await fetchTaskSummaries()).toEqual([]);
  });

  it('throws rather than passing off the first page as the full list', async () => {
    rows = makeTasks(1376);
    failFrom = 1000;

    await expect(fetchTaskSummaries()).rejects.toThrow('timeout');
  });

  it('selects the fields the pages read, not whole rows', async () => {
    await fetchTaskSummaries();

    expect(selected[0].split(', ')).toEqual(
      expect.arrayContaining(['id', 'project_id', 'name', 'end_date', 'percent_complete', 'assignees'])
    );
    expect(selected[0]).not.toContain('*');
  });
});

describe('taskSummariesQuery', () => {
  it('is refreshed by invalidating the shared tasks prefix', async () => {
    rows = makeTasks(2);
    const client = new QueryClient();
    const query = taskSummariesQuery();
    await client.fetchQuery(query);

    await client.invalidateQueries({ queryKey: ['tasks'] });

    expect(client.getQueryState(query.queryKey).isInvalidated).toBe(true);
  });
});
