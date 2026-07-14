/**
 * The tender Details tab used to have three fixed contact slots (Client,
 * Architect, Project Manager) that wrote to dedicated `client_*` /
 * `architect_*` / `project_manager_*` columns. Those slots are gone from the
 * UI — contacts now live only in the dynamic `additional_contacts` list — but
 * a few things still key off those three specific tokens:
 *   - the `tender_invitation` email template's {client_name}/{architect_name}/
 *     {project_manager_name} placeholders
 *
 * This derives best-effort values for those tokens by matching
 * `additional_contacts[].role` against the three legacy labels, falling back
 * to the legacy columns (for tenders created before this change, which may
 * still have them set and no matching additional_contacts entry).
 */
export function deriveLegacyContactNames(tender) {
  const contacts = tender?.additional_contacts || [];
  const findByRole = (re) => contacts.find(c => re.test(c.role || ''))?.name || '';

  return {
    client_name:          findByRole(/client/i)            || tender?.client_name          || '',
    architect_name:       findByRole(/architect/i)          || tender?.architect_name       || '',
    project_manager_name: findByRole(/project\s*manager|^pm$/i) || tender?.project_manager_name || '',
  };
}
