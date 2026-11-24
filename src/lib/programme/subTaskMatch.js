/**
 * subTaskMatch.js
 *
 * Put a project's subcontractors on the programme tasks their trade does, for
 * a programme that came in with nobody on it (an MS Project file with no
 * resources, an Excel/MPX import, or tasks typed in). Each sub's trade is
 * looked for in the task's own name first, then in the groups above it:
 * "Plumbing 1st fix", and a "Fit off" under a PLUMBING group, both go to the
 * plumber.
 *
 * Nothing here writes. proposeSubAssignments() suggests, the user ticks, and
 * buildAssigneeChanges() turns the ticks into tasks.assignees updates. Tasks
 * that already have someone assigned are never touched.
 */

import { normalizeEmail } from '@/lib/normalizeEmail';
import { isDraftMember, memberEmail } from '@/lib/teamInvites';
import { taskAssignees } from '@/lib/programme/assignees';
import { assigneeKey, memberDisplayName, normalizeName, tradeKey } from '@/lib/scheduleImportResources';

// What each trade's work is called in a task name, keyed by tradeKey().
// A leading ~ marks a weak term: a place or a fitting more than a trade
// ("Kitchen", "Shower", "Fascia"). It only counts when nothing stronger is in
// the name, so "Kitchen plumbing fit off" goes to the plumber, not the
// kitchen company, and it's never handed down from a group to its tasks.
// Calibrated against task and group names in live programmes (2026-11-24).
// Words go through normalizeName, which only drops a plain trailing "s", so
// "-es" plurals ("trusses", "vanities") are listed as well.
export const TASK_TERMS = {
  plumbing: ['plumbing', 'plumber', 'under slab', 'hwc', 'hot water', 'gas', 'gasfitting', 'gasfitter', 'gas fitter', 'cap off', 'shower tray', 'shower base', 'water tank', 'temp water', '~toilet', '~shower', '~vanity', '~vanities', '~bath', '~disconnection'],
  electrical: ['electrical', 'electrician', 'electric', 'sparky', 'sparkie', 'pre wire', 'prewire', 'switchboard', 'temp power', 'power', 'mains cable', 'tv aerial', 'aerial', 'lighting', 'light fitting', 'make safe', '~isolation', '~disconnection'],
  roofing: ['roofing', 'roofer', 'roof cladding', 'roof iron', 'spouting', 'gutter', 'guttering', 'downpipe', 'flashing', '~roof', '~fascia'],
  painting: ['painting', 'painter', 'paint', 'painted', 'decorating', 'decorator', 'stain', 'staining', 'cladding painted'],
  tiling: ['tiling', 'tiler', 'tile', 'tiled', 'waterproofing', 'waterproof', '~splashback', '~splash back'],
  glazing: ['glazing', 'glazier', 'glass', 'mirror', 'shower glass', 'shower door', 'shower screen', '~balustrade'],
  'gib stopping': ['gib stopping', 'gib stopper', 'gib stop', 'stopping', 'stopper', 'plastering', 'plasterer', 'interior plaster', 'gibbing', '~gib', '~aqualine'],
  flooring: ['flooring', 'floor covering', 'floor layer', 'carpet', 'vinyl', 'laminate', 'lino', 'floor sanding'],
  scaffolding: ['scaffolding', 'scaffold', 'scaffolder', 'edge protection', 'safety net'],
  joinery: ['joinery', 'joiner', 'internal joinery', 'wardrobe', 'cupboard'],
  'kitchen joinery': ['kitchen joinery', 'kitchen install', 'install kitchen', 'kitchen installation', 'kitchen measure', 'benchtop', 'bench top', 'cabinetry', 'cabinet', '~kitchen'],
  'aluminium joinery': ['aluminium joinery', 'aluminum joinery', 'aluminium', 'aluminum', 'external joinery', 'exterior joinery', 'window install', 'install window', 'sliding door', 'slider', 'ranchslider', '~window'],
  concrete: ['concrete', 'concreter', 'concreting', 'pour', 'pre pour', 'power float', 'saw cut', 'control joint', 'driveway', 'footpath', 'path', 'patio', 'boxing', 'de box', 'vehicle crossing', 'slab', 'mesh', 'reinforcing'],
  hvac: ['hvac', 'heat pump', 'air conditioning', 'air con', 'aircon', 'ac', 'heating', 'cooling', 'ventilation', 'hrv', 'dvs', 'ducting', 'heat recovery'],
  landscaping: ['landscaping', 'landscaper', 'landscape', 'softscaping', 'planting', 'plant', 'garden', 'lawn', 'grass', 'turf', 'tree', '~topsoil'],
  fencing: ['fencing', 'fence', 'fencer', 'gate', 'paling', 'aluminium gate'],
  demolition: ['demolition', 'demo', 'demolish', 'strip out'],
  carpentry: ['carpentry', 'carpenter', 'framing', 'stand frame', 'truss', 'trusses', 'purlin', 'bracing', 'mid floor', 'midfloor', 'cavity batten', 'building wrap', 'lintel', 'subfloor', 'gib fixing', 'gib fixer', 'decking', '~frame', '~trim', '~skirting', '~architrave', '~batten', '~wrap', '~soffit'],
  masonry: ['masonry', 'mason', 'stonemason', 'blockwork', 'block', 'blocklayer', 'block layer', 'stone', 'schist'],
  'int doors': ['int door', 'internal door', 'interior door', 'pre hung door', 'prehung door', 'hang door', 'door hanging', 'door hardware', '~door'],
  stairs: ['stair', 'staircase', 'stairway'],
  furnishings: ['furnishing', 'curtain', 'blind', 'drape', 'shutter'],
  cleaning: ['cleaning', 'cleaner', 'final clean', 'window clean', '~clean'],
  earthworks: ['earthwork', 'excavation', 'excavate', 'dig out', 'site cut', 'cut and fill', 'backfill', 'backfilling', 'compaction', 'bulk fill', 'erosion', 'sediment control', 'trench', 'trenches', '~dig', '~topsoil'],
  'steel erection': ['steel erection', 'structural steel', 'steelwork', 'steel beam', 'steel portal', 'portal frame', 'steel post', 'steel column'],
  'fire protection': ['fire protection', 'sprinkler', 'fire alarm', 'fire modification', 'fire stopping', 'fire rating', 'fire testing', 'passive fire', '~fire'],
  'suspended ceilings': ['suspended ceiling', 'ceiling grid', 'grid ceiling', 'ceiling tile'],
  bricklaying: ['bricklaying', 'bricklayer', 'brick', 'brick veneer', 'brick cladding', 'cladding brick'],
  drainage: ['drainage', 'drain', 'drainlayer', 'drain layer', 'drainlaying', 'stormwater', 'storm water', 'wastewater', 'waste water', 'sewer', 'manhole', 'mh', 'sump', 'soakhole', 'soak hole'],
  cladding: ['cladding', 'clad', 'cladder', 'weatherboard', 'linea', 'axon', 'duragroove', 'exterior plaster', 'plaster cladding', 'facing', 'box corner'],
  insulation: ['insulation', 'insulate', 'insulator', 'batt', 'pink batt'],
  foundations: ['foundation', 'footing', 'pile', 'piling', 'rib raft', 'slab', 'poly pod', 'pod', 'dpm', 'dpc', 'sand blinding', 'blinding', 'pre pour', 'mesh', 'reinforcing', 'boxing', 'de box'],
  'site works': ['site work', 'sitework', 'civil', 'civil work', 'joal', 'joalwork', 'basecourse', 'subbase', 'kerb', 'curb', 'vehicle crossing', 'paving', 'paved', 'carriageway', 'line marking', 'wheel stop', 'parking'],
  'frame and truss': ['frame and truss', 'frame delivery', 'truss delivery', 'trusses delivery', 'prenail', 'pre nail'],
  surveying: ['survey', 'surveyor', 'surveying', 'set out', 'setout', 'foundation set out', 'mark out', 'profile', 'peg', 'pegging'],
};

// Phrases that look like a trade but are the builder's own site setup. They
// win over the trade word inside them and assign nobody.
const NOT_A_TRADE = ['site fencing', 'security fencing', 'temporary fencing', 'temp fencing'];

// Tasks that are the builder's or someone else's, never a sub's: inspections
// (Consentium is the BCA in live programmes: "Consentium-Preline Plumbing"),
// sign-offs, meetings, the builder's own clean. They're left for the user.
const SKIP_TERMS = ['inspection', 'insp', 'consentium', 'bca', 'builder', 'council', 'engineer', 'client', 'sign off', 'signoff', 'handover', 'practical completion', 'meeting', 'prestart', 'pre start', 'paperwork', 'documentation'];

const words = (text) => normalizeName(text).split(' ').filter(Boolean);

// One typo or swapped pair of letters: "Elctrical", "Becnhtop", "Painiting".
function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// Typos only count on long words with the right first letter, so "planter"
// never reads as "plaster".
const sameWord = (a, b) => a === b || (a.length >= 8 && b.length >= 8 && a[0] === b[0] && withinOneEdit(a, b));

/** Where `phrase` (a word list) starts in `name` (a word list). */
function phraseStarts(name, phrase) {
  const starts = [];
  for (let i = 0; i + phrase.length <= name.length; i++) {
    if (phrase.every((w, j) => sameWord(name[i + j], w))) starts.push(i);
  }
  return starts;
}

const compile = (key, term) => {
  const weak = term.startsWith('~');
  return { key, weak, words: words(weak ? term.slice(1) : term) };
};

const SKIP = SKIP_TERMS.map(t => words(t));

// Every known trade's terms, whether or not the project has that sub: a
// "Scaffold … roof edge protection" task is the scaffolder's even when only
// the roofer is on the team, so it must not fall to the roofer's weak "roof".
const KNOWN_TERMS = [
  ...NOT_A_TRADE.map(t => compile('', t)),
  ...Object.entries(TASK_TERMS).flatMap(([key, terms]) => terms.map(t => compile(key, t))),
];

/**
 * The trade keys a sub covers. A trade the table knows is one key; a compound
 * one ("Plumbing & Gas") is each part; anything else is its own name, so a
 * custom trade like "Waterproofing" still finds "Waterproofing" tasks.
 */
export function subTradeKeys(trade) {
  if (!normalizeName(trade)) return [];
  const whole = tradeKey(trade);
  if (TASK_TERMS[whole]) return [whole];
  const parts = String(trade).split(/\s*(?:&|\/|,|\+|\band\b)\s*/i).map(tradeKey).filter(Boolean);
  return [...new Set(parts.length > 1 ? parts : [whole])];
}

/** The known terms plus each custom trade's own name ("Waterproofing"). */
function termsFor(keys) {
  const custom = [...keys].filter(k => !TASK_TERMS[k]).map(k => compile(k, k)).filter(t => t.words.length);
  return custom.length ? [...KNOWN_TERMS, ...custom] : KNOWN_TERMS;
}

/**
 * The trades named in a task or group name.
 *
 * @returns {{ strong: Set<string>, weak: Set<string> } | null} null for a task
 *   no sub should get (an inspection, a sign-off, the builder's own work)
 */
function tradesIn(name, terms) {
  const nameWords = words(name);
  if (SKIP.some(p => phraseStarts(nameWords, p).length)) return null;

  const hits = [];
  for (const term of terms) {
    for (const start of phraseStarts(nameWords, term.words)) {
      hits.push({ key: term.key, weak: term.weak, start, end: start + term.words.length });
    }
  }
  // A hit inside a longer hit for another trade loses: "aluminium joinery"
  // is not joinery, "fire stopping" is not gib stopping.
  const longer = (o, h) => o.key !== h.key && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start;
  const kept = hits.filter(h => h.key && !hits.some(o => longer(o, h)));
  return {
    strong: new Set(kept.filter(h => !h.weak).map(h => h.key)),
    weak: new Set(kept.filter(h => h.weak).map(h => h.key)),
  };
}

/** A pick: this sub (a proposal sub's id) on this task. */
export const pickKey = (sub, taskId) => `${sub}\n${taskId}`;

const isInvited = (m) => !!normalizeEmail(m?.user_email) && !isDraftMember(m);

/**
 * Who goes on a task for a sub (one company, one or more people on the team).
 * Everyone invited from the company is a real assignee, so each sees the task
 * under My Tasks. A company with nobody invited yet goes on by business name;
 * Send Invites later links that name to them (linkProgrammeToTeam).
 */
export function subAssignees(sub) {
  const invited = sub.members.filter(isInvited);
  if (invited.length) {
    return invited.map(m => ({
      name: memberDisplayName(m), person: m.full_name || null, email: normalizeEmail(m.user_email), msp_resource_uid: null, units: 1,
    }));
  }
  return sub.name ? [{ name: sub.name, email: null, msp_resource_uid: null, units: 1 }] : [];
}

// Words that don't tell one firm from another ("ABC Plumbing" and "XYZ
// Plumbing" share "plumbing"): trade words, plus the usual company filler.
const GENERIC_WORDS = new Set([
  ...Object.values(TASK_TERMS).flatMap(terms => terms.flatMap(t => words(t.replace(/^~/, '')))),
  ...words('contracting construction service group company co and the of hawke bay hb napier hasting commercial residential'),
]);

const initials = (name) => String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(w => w[0]).join('');

/**
 * Are two team members the same firm? Live teams type one company several
 * ways: "SW Bartholomew Ltd" / "S w Bartholomew", "Topline" / "Topline
 * Contracting Ltd, Hastings, NZ", "RFL" / "Reliable Foundations Ltd", or the
 * same person under two business names.
 */
export function sameCompany(a, b) {
  const na = normalizeName(a?.business_name);
  const nb = normalizeName(b?.business_name);
  if (na && nb) {
    const ca = na.replace(/ /g, '');
    const cb = nb.replace(/ /g, '');
    if (ca === cb) return true;
    if (ca.length >= 2 && cb.length >= 2 && (initials(a.business_name) === cb || initials(b.business_name) === ca)) return true;
    const wa = na.split(' ');
    const wb = nb.split(' ');
    const [small, big] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
    const distinctive = small.some(w => w.length >= 4 && !GENERIC_WORDS.has(w));
    if (distinctive && small.every(w => big.some(x => sameWord(w, x)))) return true;
  }
  // One person (first and last name) under two business names
  const pa = normalizeName(a?.full_name);
  return pa.includes(' ') && pa === normalizeName(b?.full_name);
}

/** "Ohmen Electrical — Logan Schollum, Mathew Watson · Electrical" */
export function subLabel(sub) {
  const people = [...new Set(sub.members.map(m => (m.full_name || memberEmail(m) || '').trim()))]
    .filter(p => p && normalizeName(p) !== normalizeName(sub.name));
  const main = people.length ? `${sub.name} — ${people.join(', ')}` : sub.name;
  return sub.trade ? `${main} · ${sub.trade}` : main;
}

const bySortOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  || String(a.wbs || '').localeCompare(String(b.wbs || ''), undefined, { numeric: true });

/**
 * Suggest which subs go on which unassigned tasks.
 *
 * Only leaf tasks with nobody assigned are considered. A task gets the trades
 * in its own name (strong terms, else weak ones), else the strong trades of
 * the nearest group above it that names any.
 *
 * Subcontractors on the team are grouped by company and trade: live teams
 * often list two or three people from one firm, and they're one sub here.
 *
 * @param {Array} tasks - programme tasks ({ id, name, wbs, parent_id, sort_order, assignees })
 * @param {Array} team  - project.team; only role 'Subcontractor' members are used
 * @returns {{
 *   subs: Array<{ id, name, members, trade, keys, draft, shared, taskIds }>,
 *   tasks: Map<string, { id, wbs, name, via }>,
 *   candidateCount: number,
 *   unmatchedIds: string[],
 *   noTradeSubs: Array,
 * }}
 *   subs are the companies with a trade, by trade then name; draft means
 *   nobody from it is invited yet; shared means another company has the same
 *   trade, so none of its tasks start ticked. tasks holds every candidate in
 *   programme order; via is the group a match came from.
 */
export function proposeSubAssignments(tasks, team) {
  const members = (team || []).filter(m => m?.role === 'Subcontractor');
  const noTradeSubs = members.filter(m => !subTradeKeys(m.trade).length);

  // Firms: members linked by sameCompany, transitively, under the earliest one
  const firmOf = members.map((_, i) => i);
  const root = (i) => (firmOf[i] === i ? i : root(firmOf[i]));
  for (let i = 0; i < members.length; i++) {
    for (let j = 0; j < i; j++) {
      if (!sameCompany(members[j], members[i])) continue;
      const [a, b] = [root(i), root(j)];
      if (a !== b) firmOf[Math.max(a, b)] = Math.min(a, b);
    }
  }

  const companies = new Map();
  members.forEach((m, i) => {
    const keys = subTradeKeys(m.trade);
    if (!keys.length) return;
    const firm = members[root(i)];
    const id = `${normalizeName(firm.business_name) || memberEmail(firm) || `team${root(i)}`}|${keys.join(',')}`;
    if (!companies.has(id)) companies.set(id, { id, name: m.business_name || m.full_name || memberEmail(m), members: [], trade: m.trade, keys });
    companies.get(id).members.push(m);
  });

  const keyCount = new Map();
  for (const c of companies.values()) for (const k of c.keys) keyCount.set(k, (keyCount.get(k) || 0) + 1);
  const terms = termsFor(new Set(keyCount.keys()));

  const sorted = [...(tasks || [])].sort(bySortOrder);
  const byId = new Map(sorted.map(t => [t.id, t]));
  const parentIds = new Set(sorted.map(t => t.parent_id).filter(Boolean));
  const ownCache = new Map();
  const own = (t) => {
    if (!ownCache.has(t.id)) ownCache.set(t.id, tradesIn(t.name, terms));
    return ownCache.get(t.id);
  };
  const fromGroup = (t) => {
    const seen = new Set();
    for (let p = byId.get(t.parent_id); p && !seen.has(p.id); p = byId.get(p.parent_id)) {
      seen.add(p.id);
      const found = own(p);
      if (found?.strong.size) return { keys: found.strong, via: p.name };
    }
    return null;
  };

  const candidates = sorted.filter(t => !parentIds.has(t.id) && taskAssignees(t).length === 0);
  const matchOf = new Map();
  for (const t of candidates) {
    const found = own(t);
    if (!found) continue;
    if (found.strong.size) matchOf.set(t.id, { keys: found.strong, via: null });
    else if (found.weak.size) matchOf.set(t.id, { keys: found.weak, via: null });
    else {
      const inherited = fromGroup(t);
      if (inherited) matchOf.set(t.id, inherited);
    }
  }

  const subs = [...companies.values()]
    .map(c => ({
      ...c,
      draft: !c.members.some(isInvited),
      shared: c.keys.some(k => keyCount.get(k) > 1),
      taskIds: candidates.filter(t => c.keys.some(k => matchOf.get(t.id)?.keys.has(k))).map(t => t.id),
    }))
    .sort((a, b) => a.trade.localeCompare(b.trade) || a.name.localeCompare(b.name));

  const matched = new Set(subs.flatMap(s => s.taskIds));
  return {
    subs,
    tasks: new Map(candidates.map(t => [t.id, { id: t.id, wbs: t.wbs || '', name: t.name || '', via: matchOf.get(t.id)?.via || null }])),
    candidateCount: candidates.length,
    unmatchedIds: candidates.filter(t => !matched.has(t.id)).map(t => t.id),
    noTradeSubs,
  };
}

/** The picks to start with: every task of every company that has its trade to itself. */
export function defaultPicks(proposal) {
  const picks = new Set();
  for (const s of proposal.subs) {
    if (s.shared) continue;
    for (const taskId of s.taskIds) picks.add(pickKey(s.id, taskId));
  }
  return picks;
}

/**
 * Turn picks into task updates, in the shape saveTaskAssignees takes. A task
 * that has gained an assignee since the proposal was made is left alone.
 *
 * @param {Array} tasks    - the current task rows
 * @param {Object} proposal - proposeSubAssignments output
 * @param {Set<string>} picks - pickKey(subId, taskId) values
 * @returns {Array<{ id, before, assignees }>}
 */
export function buildAssigneeChanges(tasks, proposal, picks) {
  const current = new Map((tasks || []).map(t => [t.id, t]));
  const byTask = new Map();
  for (const s of proposal.subs) {
    const people = subAssignees(s);
    for (const taskId of s.taskIds) {
      if (!picks.has(pickKey(s.id, taskId))) continue;
      const list = byTask.get(taskId) || [];
      // One company under two trades ("Concrete", "Site Works") → once
      for (const a of people) if (!list.some(b => assigneeKey(b) === assigneeKey(a))) list.push(a);
      if (list.length) byTask.set(taskId, list);
    }
  }

  const changes = [];
  for (const [id, assignees] of byTask) {
    const task = current.get(id);
    if (!task || taskAssignees(task).length) continue;
    changes.push({ id, before: [], assignees });
  }
  return changes;
}
