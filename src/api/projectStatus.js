import { supabase } from '@/api/supabaseClient';

// Open projects are worked on and visible to the team. Closed projects are only
// visible to admins, enforced in the database (migration 031).
export const OPEN_PROJECT_STATUSES = ['Active', 'On Hold'];
export const CLOSED_PROJECT_STATUSES = ['Complete', 'Archived'];

export function isClosedStatus(status) {
  return CLOSED_PROJECT_STATUSES.includes(status);
}

export function isOpenProject(project) {
  return OPEN_PROJECT_STATUSES.includes(project?.status);
}

// Always change status through here, not Project.update: a non-admin can't close a
// project with a direct update because they can't see the row they'd be writing.
// The function also records the change in the project's activity feed.
export async function setProjectStatus(projectId, status) {
  const { data, error } = await supabase.rpc('set_project_status', {
    p_project_id: projectId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}
