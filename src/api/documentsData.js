/**
 * documentsData.js
 *
 * Every document the user can read, or every one in a project, newest first, as
 * whole rows: the Documents and ProjectDetail pages hand them to ProjectDocsPanel,
 * and the Dashboard counts them and lists the latest few.
 */

import { supabase } from '@/api/supabaseClient';
import { fetchAllRows } from '@/api/fetchAllRows';

/**
 * The one query behind the ['documents'] key. Pages share this cache entry, so a
 * page fetching a shorter list under the same key would leave the next page
 * showing it. Invalidating this prefix also refreshes projectDocumentsQuery.
 */
export function documentsQuery() {
  return {
    queryKey: ['documents'],
    queryFn: fetchDocuments,
  };
}

export function projectDocumentsQuery(projectId) {
  return {
    queryKey: ['documents', projectId],
    queryFn: () => fetchProjectDocuments(projectId),
  };
}

const selectDocuments = () => supabase.from('documents').select('*', { count: 'exact' });

const newestFirst = (query) => query.order('created_at', { ascending: false }).order('id', { ascending: true });

export function fetchDocuments() {
  return fetchAllRows(() => newestFirst(selectDocuments()));
}

export function fetchProjectDocuments(projectId) {
  return fetchAllRows(() => newestFirst(selectDocuments().eq('project_id', projectId)));
}
