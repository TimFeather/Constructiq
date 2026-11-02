import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

let rows = [];
let failFrom = null;

// Minimal PostgREST stand-in: applies .eq() and .order(), and caps every response at 1000 rows like the real one.
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from() {
      const orders = [];
      const filters = [];
      const query = {
        select: () => query,
        eq(column, value) { filters.push({ column, value }); return query; },
        order(column, { ascending }) { orders.push({ column, ascending }); return query; },
        range(from, to) { query.bounds = [from, to]; return query; },
        then(resolve) {
          const [from, to] = query.bounds;
          if (failFrom !== null && from >= failFrom) return resolve({ data: null, error: new Error('timeout'), count: null });
          const matching = rows.filter(row => filters.every(({ column, value }) => row[column] === value));
          const sorted = matching.sort((a, b) => {
            for (const { column, ascending } of orders) {
              const order = String(a[column]).localeCompare(String(b[column]));
              if (order !== 0) return ascending ? order : -order;
            }
            return 0;
          });
          resolve({ data: sorted.slice(from, Math.min(to + 1, from + 1000)), error: null, count: matching.length });
        },
      };
      return query;
    },
  },
}));

const { fetchDocuments, documentsQuery, fetchProjectDocuments, projectDocumentsQuery } = await import('@/api/documentsData');

// Oldest first, so anything not ordering by created_at gets the wrong five.
const makeDocs = (n) => Array.from({ length: n }, (_, i) => ({
  id: `d${String(i).padStart(5, '0')}`,
  project_id: 'p1',
  created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
}));

beforeEach(() => {
  rows = [];
  failFrom = null;
});

describe('fetchDocuments', () => {
  it('returns every document, past the old 100 and 200 row limits', async () => {
    rows = makeDocs(188);
    expect(await fetchDocuments()).toHaveLength(188);

    rows = makeDocs(250);
    expect(await fetchDocuments()).toHaveLength(250);
  });

  it('returns every document past the 1000-row response cap', async () => {
    rows = makeDocs(1376);

    const documents = await fetchDocuments();

    expect(documents).toHaveLength(1376);
    expect(new Set(documents.map(d => d.id)).size).toBe(1376);
  });

  it('puts the latest documents first, for the Recent Documents list', async () => {
    rows = makeDocs(188);

    const documents = await fetchDocuments();

    expect(documents.slice(0, 5).map(d => d.id)).toEqual(['d00187', 'd00186', 'd00185', 'd00184', 'd00183']);
  });

  it('breaks created_at ties on id, so pages cannot skip rows', async () => {
    rows = makeDocs(3).map(d => ({ ...d, created_at: '2026-01-01T00:00:00.000Z' }));

    expect((await fetchDocuments()).map(d => d.id)).toEqual(['d00000', 'd00001', 'd00002']);
  });

  it('returns nothing, not an error, when there are no documents', async () => {
    expect(await fetchDocuments()).toEqual([]);
  });

  it('throws rather than passing off the first page as the full list', async () => {
    rows = makeDocs(1376);
    failFrom = 1000;

    await expect(fetchDocuments()).rejects.toThrow('timeout');
  });
});

describe('fetchProjectDocuments', () => {
  it('returns every document in the project, past the old 50 row limit', async () => {
    rows = makeDocs(60);

    const documents = await fetchProjectDocuments('p1');

    expect(documents).toHaveLength(60);
    expect(documents[0].id).toBe('d00059');
  });

  it('leaves out documents in other projects', async () => {
    rows = [...makeDocs(3), { ...makeDocs(4)[3], project_id: 'p2' }];

    const documents = await fetchProjectDocuments('p2');

    expect(documents.map(d => d.id)).toEqual(['d00003']);
  });

  it('pages past the 1000-row response cap', async () => {
    rows = makeDocs(1376);

    expect(await fetchProjectDocuments('p1')).toHaveLength(1376);
  });
});

describe('projectDocumentsQuery', () => {
  it('is refreshed by invalidating the shared documents prefix, and keeps its own cache entry', async () => {
    rows = makeDocs(2);
    const client = new QueryClient();
    const query = projectDocumentsQuery('p1');
    await client.fetchQuery(query);

    await client.invalidateQueries({ queryKey: ['documents'] });

    expect(client.getQueryState(query.queryKey).isInvalidated).toBe(true);
    expect(query.queryKey).not.toEqual(documentsQuery().queryKey);
  });
});

describe('documentsQuery', () => {
  it('is refreshed by invalidating the shared documents prefix', async () => {
    rows = makeDocs(2);
    const client = new QueryClient();
    const query = documentsQuery();
    await client.fetchQuery(query);

    await client.invalidateQueries({ queryKey: ['documents'] });

    expect(client.getQueryState(query.queryKey).isInvalidated).toBe(true);
  });
});
