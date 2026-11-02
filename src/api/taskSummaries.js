/**
 * taskSummaries.js
 *
 * Every task the user can read, with only the fields the Dashboard and Projects
 * pages count and list. No dependencies or engine shape: those are for
 * programmeTasksQuery in programmeData.js.
 */

import { supabase } from '@/api/supabaseClient';
import { fetchAllRows } from '@/api/fetchAllRows';

const SUMMARY_COLUMNS = 'id, project_id, name, end_date, percent_complete, assignees';

/**
 * The one query for task summaries. Its key sits under ['tasks'] so the callers
 * invalidating that prefix refresh it too, and 'summaries' can't collide with
 * programmeTasksQuery's ['tasks', projectId], whose second part is a uuid or 'all'.
 */
export function taskSummariesQuery() {
  return {
    queryKey: ['tasks', 'summaries'],
    queryFn: fetchTaskSummaries,
  };
}

export function fetchTaskSummaries() {
  return fetchAllRows(() =>
    supabase.from('tasks').select(SUMMARY_COLUMNS, { count: 'exact' }).order('id', { ascending: true })
  );
}
