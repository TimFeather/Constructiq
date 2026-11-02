/**
 * Fetch every row of a query, page by page. PostgREST silently caps a response
 * at its max-rows setting whatever .limit() asks for, so a single request can
 * lose rows. `buildQuery` must select with { count: 'exact' } and apply a total
 * order, or pages can skip rows.
 */
export async function fetchAllRows(buildQuery) {
  const PAGE = 1000;
  const rows = [];
  for (;;) {
    const { data, error, count } = await buildQuery().range(rows.length, rows.length + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length === 0 || rows.length >= count) return rows;
  }
}
