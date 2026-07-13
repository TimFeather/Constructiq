/**
 * Shared contact-search predicate used by PersonAutocomplete, InviteeManager's
 * subcontractor search, and the Settings Subcontractor Directory, so all
 * contact search boxes match on the same four fields the same way.
 */
export function contactMatchesQuery(contact, query) {
  const q = query.toLowerCase();
  return (
    contact.full_name?.toLowerCase().includes(q) ||
    contact.business_name?.toLowerCase().includes(q) ||
    contact.email?.toLowerCase().includes(q) ||
    contact.trade?.toLowerCase().includes(q)
  );
}

export function filterContacts(contacts, query) {
  return contacts.filter(c => contactMatchesQuery(c, query));
}
