/**
 * documentsData.js
 *
 * Every document the user can read, newest first, as whole rows: the Documents
 * page hands them to ProjectDocsPanel, and the Dashboard counts them and lists
 * the latest few.
 */

import { supabase } from '@/api/supabaseClient';
import { fetchAllRows } from '@/api/fetchAllRows';

/**
 * The one query behind the ['documents'] key. Pages share this cache entry, so a
 * page fetching a shorter list under the same key would leave the next page
 * showing it. ['documents', projectId] is a separate per-project list that
 * invalidating this prefix also refreshes.
 */
export function documentsQuery() {
  return {
    queryKey: ['documents'],
    queryFn: fetchDocuments,
  };
}

export function fetchDocuments() {
  return fetchAllRows(() =>
    supabase
      .from('documents')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
  );
}
