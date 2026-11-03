/**
 * Sort a project's team into the groups the Team tab shows: the THS team, the
 * client, consultants and other outside parties, then subcontractors.
 *
 * A member is THS when their project role carries an internal permission
 * (admin / internal / pricing) in project_roles. External viewers can't read
 * project_roles, so when a role isn't in the list we fall back to the role
 * names THS uses for its own staff.
 */

export const TEAM_GROUPS = [
  { key: 'ths', label: 'THS Team' },
  { key: 'client', label: 'Client' },
  { key: 'other', label: 'Consultants & Others' },
  { key: 'subcontractor', label: 'Subcontractors' },
];

const INTERNAL_PERMISSIONS = ['admin', 'internal', 'pricing'];
const KNOWN_INTERNAL_ROLES = ['admin', 'site manager', 'internal project manager', 'quantity surveyor'];

const norm = (s) => String(s || '').trim().toLowerCase();

export function teamGroupFor(member, roles = []) {
  const role = norm(member?.role);
  if (role === 'subcontractor') return 'subcontractor';
  if (/^client\b/.test(role)) return 'client';
  const match = roles.find(r => norm(r.name) === role);
  if (match) return INTERNAL_PERMISSIONS.includes(match.permission_role) ? 'ths' : 'other';
  if (KNOWN_INTERNAL_ROLES.includes(role) || /^ths\b/.test(role)) return 'ths';
  return 'other';
}

/**
 * Returns TEAM_GROUPS, each with its members. Every member keeps `index`, its
 * position in the full team array, so edit/remove still address the right row.
 * THS staff follow the role list's order; subcontractors sort by trade, with
 * no-trade entries last.
 */
export function groupTeam(team, roles = []) {
  const order = roles.map(r => norm(r.name));
  const rank = (m) => {
    const i = order.indexOf(norm(m.role));
    return i === -1 ? order.length : i;
  };
  const byKey = Object.fromEntries(TEAM_GROUPS.map(g => [g.key, []]));
  (team || []).forEach((member, index) => {
    byKey[teamGroupFor(member, roles)].push({ ...member, index });
  });
  byKey.ths.sort((a, b) => rank(a) - rank(b));
  byKey.subcontractor.sort((a, b) =>
    (a.trade ? 0 : 1) - (b.trade ? 0 : 1) || norm(a.trade).localeCompare(norm(b.trade)));
  return TEAM_GROUPS.map(g => ({ ...g, members: byKey[g.key] }));
}
