/**
 * scheduleImportResources.js
 *
 * Pure helpers for turning MS Project resources into CIQ task assignees.
 * MS Project resources are companies ("ABC Plumbing Ltd"), trades
 * ("Plumber") or people, depending on who wrote the programme, so each one
 * is matched against the project team (project.team) by email, then name,
 * then trade. Exact matches apply silently; trade matches and anything
 * ambiguous or unmatched go to the import's Resources step.
 *
 * A choice (also the shape saved in programmes.resource_map, keyed by
 * MS Project resource UID, with the resource name alongside):
 *   { action: 'member', email }  → assignee is that team member
 *   { action: 'label' }          → assignee is the resource name, no email
 *   { action: 'ignore' }         → not an assignee
 */

import { normalizeEmail } from '@/lib/normalizeEmail';

const STRIP_WORDS = new Set(['ltd', 'limited', 'nz', 'contractor', 'contractors', 'subcontractor', 'subcontractors']);

// "Plumbers" → "plumber", but not "glass" or short words like "bus"
const singular = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

/**
 * Comparable form of a company, person or trade name: lowercase, no
 * punctuation, no Ltd/Limited/NZ or contractor/subcontractor, singular words.
 * "ABC Plumbing (NZ) Ltd" → "abc plumbing"; "Roofing Contractors" → "roofing".
 */
export function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(w => w && !STRIP_WORDS.has(w))
    .map(singular)
    .join(' ');
}

// CIQ trades name the work ("Plumbing", "Gib stopping"); an MS Project trade
// resource usually names the person ("Plumber", "Gib stopper"). Each group maps
// both onto one key. Built from the trades on live project teams (2026-10-30).
const TRADE_ALIASES = {
  plumbing: ['plumbing', 'plumber'],
  electrical: ['electrical', 'electrician', 'electric', 'sparky', 'sparkie'],
  roofing: ['roofing', 'roofer'],
  painting: ['painting', 'painter', 'painter and decorator', 'decorator'],
  tiling: ['tiling', 'tiler'],
  glazing: ['glazing', 'glazier'],
  'gib stopping': ['gib stopping', 'gib stopper', 'stopper', 'stopping', 'plasterer', 'plastering'],
  flooring: ['flooring', 'floor layer', 'floorer', 'carpet layer'],
  scaffolding: ['scaffolding', 'scaffolder', 'scaffold'],
  joinery: ['joinery', 'joiner'],
  'kitchen joinery': ['kitchen joinery', 'kitchen joiner', 'cabinet maker', 'cabinetmaker', 'kitchen'],
  'aluminium joinery': ['aluminium joinery', 'aluminum joinery', 'aluminium joiner', 'aluminum joiner'],
  concrete: ['concrete', 'concreter', 'concreting'],
  earthworks: ['earthworks', 'excavation', 'excavator', 'digger', 'digger driver'],
  'steel erection': ['steel erection', 'steel erector', 'steelworker', 'steel fixer'],
  'fire protection': ['fire protection', 'sprinkler fitter', 'fire sprinkler'],
  'suspended ceilings': ['suspended ceilings', 'ceiling fixer', 'ceilings'],
  bricklaying: ['bricklaying', 'bricklayer', 'brick layer', 'brickie'],
  drainage: ['drainage', 'drainlayer', 'drain layer', 'drainlaying'],
  cladding: ['cladding', 'cladder'],
  insulation: ['insulation', 'insulator', 'insulation installer'],
};
const TRADE_KEY = new Map(
  Object.entries(TRADE_ALIASES).flatMap(([key, aliases]) => aliases.map(a => [normalizeName(a), key]))
);

/** Comparable trade: "Plumbers" and "Plumbing" give the same key. */
export function tradeKey(value) {
  const name = normalizeName(value);
  return TRADE_KEY.get(name) || name;
}

const sameTrade = (a, b) => {
  const ka = tradeKey(a);
  return !!ka && ka === tradeKey(b);
};

/** Team members a resource can map to: those with an email, one per address. */
export function assignableMembers(team) {
  const byEmail = new Map();
  for (const m of team || []) {
    const email = normalizeEmail(m?.user_email);
    if (email && !byEmail.has(email)) byEmail.set(email, { ...m, user_email: email });
  }
  return [...byEmail.values()];
}

/** What a team member is called on a task: their business, else their name. */
export function memberDisplayName(member) {
  return member?.business_name || member?.full_name || member?.user_email || '';
}

/**
 * A team member in a dropdown: "Sparks Electrical — Jo Watt · Electrical".
 * The person (or their email, if unnamed) always shows, so two people from
 * the same company can be told apart.
 */
export function memberOptionLabel(member) {
  const person = member?.full_name || member?.user_email || '';
  const business = member?.business_name || '';
  const main = business && normalizeName(business) !== normalizeName(person) ? `${business} — ${person}` : (business || person);
  return member?.trade ? `${main} · ${member.trade}` : main;
}

const sameName = (a, b) => {
  const na = normalizeName(a);
  return !!na && na === normalizeName(b);
};

/**
 * Match each resource against the team.
 *
 * @param {Array} resources - parseMspdiResources output
 * @param {Array} team      - project.team
 * @param {Object} savedMap - programmes.resource_map
 * @returns {Array<{ resource, status, choice, candidates }>}
 *   status: 'saved' | 'exact' (applied silently) or 'trade' | 'ambiguous' |
 *   'unmatched' (shown for review). choice is the pre-selected choice;
 *   candidates are the team members the match pointed at.
 */
export function matchResources(resources, team, savedMap = {}) {
  const members = assignableMembers(team);
  const memberEmails = new Set(members.map(m => m.user_email));

  return resources.map(resource => {
    // A saved choice holds while the resource keeps its name and, for a
    // member, that member is still on the team.
    const saved = savedMap?.[String(resource.uid)];
    if (saved && sameName(saved.name, resource.name)) {
      if (saved.action === 'label' || saved.action === 'ignore') {
        return { resource, status: 'saved', choice: { action: saved.action }, candidates: [] };
      }
      const email = normalizeEmail(saved.email);
      if (saved.action === 'member' && memberEmails.has(email)) {
        return { resource, status: 'saved', choice: { action: 'member', email }, candidates: [] };
      }
    }

    const email = normalizeEmail(resource.email);
    const byEmail = email ? members.filter(m => m.user_email === email) : [];
    const byName = byEmail.length ? byEmail
      : members.filter(m => sameName(resource.name, m.business_name) || sameName(resource.name, m.full_name));
    if (byName.length === 1) {
      return { resource, status: 'exact', choice: { action: 'member', email: byName[0].user_email }, candidates: byName };
    }
    // Two people from the same business both match "ABC Plumbing"
    if (byName.length > 1) {
      return { resource, status: 'ambiguous', choice: { action: 'label' }, candidates: byName };
    }

    const byTrade = members.filter(m => sameTrade(resource.name, m.trade) || sameTrade(resource.group, m.trade));
    if (byTrade.length === 1) {
      return { resource, status: 'trade', choice: { action: 'member', email: byTrade[0].user_email }, candidates: byTrade };
    }
    if (byTrade.length > 1) {
      return { resource, status: 'ambiguous', choice: { action: 'label' }, candidates: byTrade };
    }
    return { resource, status: 'unmatched', choice: { action: 'label' }, candidates: [] };
  });
}

/** Does this match need the user to look at it? */
export const needsReview = (match) => !['saved', 'exact'].includes(match.status);

/** One assignee's identity: their email, or for a name-only assignee, the name. */
export const assigneeKey = (a) => (a.email ? `e:${normalizeEmail(a.email)}` : `n:${normalizeName(a.name)}`);

/** Order-insensitive identity of an assignee list, for import diffs. */
export function assigneesKey(assignees) {
  return (assignees || []).map(assigneeKey).sort().join('|');
}

/**
 * Turn each parsed task's _mspAssignments into `assignees`.
 *
 * The file wins: a task with no assignments gets []. The exception is a task
 * whose every resource is ignored. It's left without an `assignees` key, so
 * an update import keeps whatever CIQ has for it.
 *
 * @param {Array} parsedTasks - parseXML output
 * @param {Array} resources   - parseMspdiResources output
 * @param {Map<number, Object>} choices - resource UID → choice
 * @param {Array} team        - project.team
 * @returns {Array} new task objects (the input is not mutated)
 */
export function resolveAssignees(parsedTasks, resources, choices, team) {
  const resourceByUid = new Map(resources.map(r => [r.uid, r]));
  const memberByEmail = new Map(assignableMembers(team).map(m => [m.user_email, m]));

  return parsedTasks.map(task => {
    const assignments = task._mspAssignments || [];
    if (!assignments.length) return { ...task, assignees: [] };

    const assignees = [];
    const seen = new Set();
    for (const { resourceUid, units } of assignments) {
      const resource = resourceByUid.get(resourceUid);
      const choice = choices.get(resourceUid) || { action: 'label' };
      if (!resource || choice.action === 'ignore') continue;

      const member = choice.action === 'member' ? memberByEmail.get(normalizeEmail(choice.email)) : null;
      const assignee = member
        ? { name: memberDisplayName(member), person: member.full_name || null, email: member.user_email, msp_resource_uid: resourceUid, units }
        : { name: resource.name, email: null, msp_resource_uid: resourceUid, units };
      // "ABC Plumbing" and "Plumber" both mapped to ABC on one task → one assignee
      const key = assigneeKey(assignee);
      if (seen.has(key)) continue;
      seen.add(key);
      assignees.push(assignee);
    }

    if (!assignees.length) return { ...task };
    return { ...task, assignees };
  });
}

/**
 * The programmes.resource_map to save: the previous map with this file's
 * choices laid over it (resources not in this file keep their entries).
 */
export function buildResourceMap(previousMap, resources, choices) {
  const next = { ...(previousMap || {}) };
  for (const r of resources) {
    const choice = choices.get(r.uid);
    if (!choice) continue;
    next[String(r.uid)] = choice.action === 'member'
      ? { name: r.name, action: 'member', email: normalizeEmail(choice.email) }
      : { name: r.name, action: choice.action };
  }
  return next;
}
