import { describe, it, expect } from 'vitest';
import { tradeKey } from '@/lib/scheduleImportResources';
import {
  TASK_TERMS, subTradeKeys, subAssignees, subLabel, sameCompany, proposeSubAssignments, defaultPicks, pickKey, buildAssigneeChanges,
} from '../subTaskMatch.js';

const sub = (email, business, trade, extra = {}) => ({
  user_email: email, full_name: `${business} person`, business_name: business, role: 'Subcontractor', trade, ...extra,
});

const TEAM = [
  sub('sam@abcplumbing.co.nz', 'ABC Plumbing', 'Plumbing'),
  sub('jo@sparks.co.nz', 'Sparks Electrical', 'Electrical'),
  sub('ross@toproofs.co.nz', 'Top Roofs', 'Roofing'),
  sub('al@alu.co.nz', 'Alu Windows', 'Aluminium Joinery'),
  sub('kit@kitchens.co.nz', 'Kitchens R Us', 'Kitchen Joinery'),
  sub('gib@stop.co.nz', 'Smooth Walls', 'Gib Stopping'),
  sub('sc@scaff.co.nz', 'Up Scaffolding', 'Scaffolding'),
  sub('f@floors.co.nz', 'Floor Co', 'Flooring'),
  sub('fence@f.co.nz', 'Fence Co', 'Fencing'),
  sub('ft@frames.co.nz', 'Frametech', 'Frame And Truss'),
  sub('carp@crew.co.nz', 'Carpentry Crew', 'Carpentry'),
  { user_email: 'pat@ths.co.nz', full_name: 'Pat Manager', business_name: '', role: 'Site Manager', trade: '' },
  sub('', 'No Trade Ltd', ''),
];

let seq = 0;
const task = (name, extra = {}) => ({ id: `t${++seq}`, name, wbs: String(seq), parent_id: null, sort_order: seq, assignees: [], ...extra });

/** name → business names the proposal puts on it */
function assignedNames(tasks, team = TEAM) {
  const proposal = proposeSubAssignments(tasks, team);
  const out = {};
  for (const t of tasks) out[t.name] = [];
  for (const s of proposal.subs) {
    for (const id of s.taskIds) out[tasks.find(t => t.id === id).name].push(s.name);
  }
  return out;
}

describe('TASK_TERMS', () => {
  it('is keyed by tradeKey values, so a sub filed under any alias finds them', () => {
    for (const key of Object.keys(TASK_TERMS)) expect(tradeKey(key)).toBe(key);
  });
});

describe('subTradeKeys', () => {
  it('maps known trades, splits compound ones, and keeps custom ones', () => {
    expect(subTradeKeys('Plumber')).toEqual(['plumbing']);
    expect(subTradeKeys('Siteworks')).toEqual(['site works']);
    expect(subTradeKeys('Plumbing & Gas')).toEqual(['plumbing', 'gas']);
    expect(subTradeKeys('Planting / Softscaping')).toEqual(['landscaping']);
    expect(subTradeKeys('Waterproofing')).toEqual(['waterproofing']);
    expect(subTradeKeys('')).toEqual([]);
  });
});

describe('proposeSubAssignments — real task names', () => {
  it('matches a task by the trade in its name', () => {
    const names = assignedNames([
      task('Plumbing 1st fix'), task('Elctrical pre wire'), task('Electrical & Plumbing fit off'),
      task('Roofing install'), task('Gutter & Downpipes'), task('Becnhtop install'),
      task('Gib stopping & Sanding'), task('Rmove scaffold'), task('Floor converings'), task('Lay carpet'),
    ]);
    expect(names['Plumbing 1st fix']).toEqual(['ABC Plumbing']);
    expect(names['Elctrical pre wire']).toEqual(['Sparks Electrical']);
    expect(names['Electrical & Plumbing fit off'].sort()).toEqual(['ABC Plumbing', 'Sparks Electrical']);
    expect(names['Roofing install']).toEqual(['Top Roofs']);
    expect(names['Gutter & Downpipes']).toEqual(['Top Roofs']);
    expect(names['Becnhtop install']).toEqual(['Kitchens R Us']);
    expect(names['Gib stopping & Sanding']).toEqual(['Smooth Walls']);
    expect(names['Rmove scaffold']).toEqual(['Up Scaffolding']);
    expect(names['Floor converings']).toEqual(['Floor Co']);
    expect(names['Lay carpet']).toEqual(['Floor Co']);
  });

  it('lets the longer phrase win: aluminium joinery is not joinery, frame delivery is not framing', () => {
    const names = assignedNames([
      task('Install new Aluminium joinery ND01, NW01'), task('1st Frame delivery including IT wall'),
      task('Stand trusses'), task('Install aluminium gates'),
    ]);
    expect(names['Install new Aluminium joinery ND01, NW01']).toEqual(['Alu Windows']);
    expect(names['1st Frame delivery including IT wall']).toEqual(['Frametech']);
    expect(names['Stand trusses']).toEqual(['Carpentry Crew']);
    expect(names['Install aluminium gates']).toEqual(['Fence Co']);
  });

  it('only uses a weak word when nothing stronger is named', () => {
    const names = assignedNames([
      task('Kitchen'), task('Kitchen plumbing fit off'), task('Shower install'), task('Fascia'),
      task('Scaffold- final lift including roof edge protection'), task('Painting of trims and frames'),
    ]);
    expect(names.Kitchen).toEqual(['Kitchens R Us']);
    expect(names['Kitchen plumbing fit off']).toEqual(['ABC Plumbing']);
    expect(names['Shower install']).toEqual(['ABC Plumbing']);
    expect(names.Fascia).toEqual(['Top Roofs']);
    expect(names['Scaffold- final lift including roof edge protection']).toEqual(['Up Scaffolding']);
    // Painting is named outright, so the carpenter's weak "trim"/"frame" don't
    // count, even with no painter on this team to take it
    expect(names['Painting of trims and frames']).toEqual([]);
  });

  it('leaves inspections, sign-offs and the builder’s own work alone', () => {
    const names = assignedNames([
      task('Consentium-Preline Plumbing'), task('Framing Inspections'), task('Builders clean'),
      task('Builder site set up. Security fencing, gate, H&S setup'), task('Site fencing, H&S setup, protection works'),
      task('Client sign off'),
    ]);
    for (const list of Object.values(names)) expect(list).toEqual([]);
  });

  it('falls back to the group a task sits under, but only a group that names a trade outright', () => {
    const plumbing = task('PLUMBING');
    const kitchenReno = task('Burrows Kitchen reno');
    const tasks = [
      plumbing, task('Fit off', { parent_id: plumbing.id }), task('Electrical fit off', { parent_id: plumbing.id }),
      kitchenReno, task('Make good walls', { parent_id: kitchenReno.id }),
    ];
    const proposal = proposeSubAssignments(tasks, TEAM);
    const names = assignedNames(tasks);
    expect(names['Fit off']).toEqual(['ABC Plumbing']);
    expect(names['Electrical fit off']).toEqual(['Sparks Electrical']);
    expect(names['Make good walls']).toEqual([]);
    expect(proposal.tasks.get(tasks[1].id).via).toBe('PLUMBING');
    // Groups themselves are never candidates
    expect(proposal.tasks.has(plumbing.id)).toBe(false);
  });

  it('skips tasks that already have someone, and reports subs with no trade', () => {
    const tasks = [task('Plumbing first fix', { assignees: [{ name: 'Builder', email: null }] }), task('Plumbing second fix')];
    const proposal = proposeSubAssignments(tasks, TEAM);
    expect(proposal.candidateCount).toBe(1);
    expect(proposal.subs.find(s => s.name === 'ABC Plumbing').taskIds).toEqual([tasks[1].id]);
    expect(proposal.noTradeSubs.map(m => m.business_name)).toEqual(['No Trade Ltd']);
    // Non-subs are never offered
    expect(proposal.subs.some(s => s.members.some(m => m.role !== 'Subcontractor'))).toBe(false);
  });
});

describe('picks and changes', () => {
  it('ticks a company’s tasks unless another company has the same trade', () => {
    const team = [...TEAM, sub('two@plumb.co.nz', 'Second Plumbing', 'Plumber')];
    const tasks = [task('Plumbing first fix'), task('Electrical first fix')];
    const proposal = proposeSubAssignments(tasks, team);
    const picks = defaultPicks(proposal);
    const plumbers = proposal.subs.filter(s => s.keys.includes('plumbing'));
    expect(plumbers).toHaveLength(2);
    expect(plumbers.every(s => s.shared && s.taskIds.length === 1)).toBe(true);
    const sparks = proposal.subs.find(s => s.name === 'Sparks Electrical');
    expect([...picks]).toEqual([pickKey(sparks.id, tasks[1].id)]);
  });

  it('treats two people from one company as one sub, and assigns both', () => {
    const team = [
      sub('logan@ohmen.co.nz', 'Ohmen Electrical', 'Electrical', { full_name: 'Logan Schollum' }),
      sub('mat@ohmen.co.nz', 'Ohmen Electrical Ltd', 'Electrician', { full_name: 'Mathew Watson' }),
    ];
    const tasks = [task('Electrical first fix')];
    const proposal = proposeSubAssignments(tasks, team);
    expect(proposal.subs).toHaveLength(1);
    const [ohmen] = proposal.subs;
    expect(ohmen.shared).toBe(false);
    expect(subLabel(ohmen)).toBe('Ohmen Electrical — Logan Schollum, Mathew Watson · Electrical');
    const [change] = buildAssigneeChanges(tasks, proposal, defaultPicks(proposal));
    expect(change.assignees.map(a => a.email)).toEqual(['logan@ohmen.co.nz', 'mat@ohmen.co.nz']);
  });

  it('knows one firm typed several ways, but keeps different firms apart', () => {
    let n = 0;
    const m = (business, full = `Person ${++n}`) => ({ business_name: business, full_name: full });
    expect(sameCompany(m('S w Bartholomew'), m('SW Bartholomew Ltd'))).toBe(true);
    expect(sameCompany(m('Topline'), m('Topline Contracting Ltd, Hastings, NZ'))).toBe(true);
    expect(sameCompany(m('Topline Conctracting'), m('Topline Contracting'))).toBe(true);
    expect(sameCompany(m('RFL'), m('Reliable Foundations Ltd'))).toBe(true);
    expect(sameCompany(m('Alchemy Plumbing'), m('Alchemy Plumbing & Gas ltd'))).toBe(true);
    expect(sameCompany(m('Mitre 10'), m('Mitre10'))).toBe(true);
    expect(sameCompany(m('Bartholomew Plumbing', 'Sam Bartholomew'), m('SW Bartholomew Ltd', 'Sam Bartholomew'))).toBe(true);

    expect(sameCompany(m('Metro Glass Napier'), m('East Coast Glass and Glazing'))).toBe(false);
    expect(sameCompany(m('Plumbing'), m('ABC Plumbing'))).toBe(false);
    expect(sameCompany(m('Aurae Ltd'), m('Nichol Glass'))).toBe(false);
    expect(sameCompany(m('Daniel', 'Daniel'), m('Other', 'Daniel'))).toBe(false);
  });

  it('builds one change per ticked task, members by email and drafts by name', () => {
    const draft = { full_name: 'Gary', business_name: 'Gib Fixers', role: 'Subcontractor', trade: 'Gib stopping', invite_email: 'g@gib.nz', invite_status: 'Draft', draft_id: 'd1' };
    const team = [TEAM[0], TEAM[1], draft];
    const tasks = [task('Electrical & Plumbing fit off'), task('Gib stopping'), task('Plumbing first fix')];
    const proposal = proposeSubAssignments(tasks, team);
    const picks = defaultPicks(proposal);
    const abc = proposal.subs.find(s => s.name === 'ABC Plumbing');
    picks.delete(pickKey(abc.id, tasks[2].id));
    // Assigned by someone else after the dialog opened → left alone
    const current = tasks.map(t => (t.id === tasks[1].id ? { ...t, assignees: [{ name: 'Builder', email: null }] } : t));

    const changes = buildAssigneeChanges(current, proposal, picks);
    expect(changes).toEqual([
      {
        id: tasks[0].id,
        before: [],
        assignees: [
          { name: 'Sparks Electrical', person: 'Sparks Electrical person', email: 'jo@sparks.co.nz', msp_resource_uid: null, units: 1 },
          { name: 'ABC Plumbing', person: 'ABC Plumbing person', email: 'sam@abcplumbing.co.nz', msp_resource_uid: null, units: 1 },
        ],
      },
    ]);
    const gib = proposal.subs.find(s => s.name === 'Gib Fixers');
    expect(gib.draft).toBe(true);
    expect(subAssignees(gib)).toEqual([{ name: 'Gib Fixers', email: null, msp_resource_uid: null, units: 1 }]);
  });
});
