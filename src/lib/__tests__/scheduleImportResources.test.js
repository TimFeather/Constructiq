import { describe, it, expect } from 'vitest';
import {
  normalizeName, tradeKey, assignableMembers, matchResources, needsReview,
  resolveAssignees, assigneesKey, buildResourceMap,
} from '../scheduleImportResources.js';

const TEAM = [
  { user_email: ' Office@ABCPlumbing.co.nz', full_name: 'Sam Pipe', business_name: 'ABC Plumbing', role: 'Subcontractor', trade: 'Plumbing' },
  { user_email: 'jo@sparks.co.nz', full_name: 'Jo Watt', business_name: 'Sparks Electrical', role: 'Subcontractor', trade: 'Electrical' },
  { user_email: 'kim@sparks.co.nz', full_name: 'Kim Volt', business_name: 'Sparks Electrical', role: 'Subcontractor', trade: 'Electrical' },
  { user_email: 'ross@toproofs.co.nz', full_name: 'Ross Tile', business_name: 'Top Roofs Ltd', role: 'Subcontractor', trade: 'Roofing' },
  { user_email: 'pat@ths.co.nz', full_name: 'Pat Manager', business_name: '', role: 'Site Manager', trade: '' },
  { user_email: '', full_name: 'Gary', business_name: 'Gib Fixers', role: 'Subcontractor', trade: 'Gib stopping' },
  { user_email: 'JO@sparks.co.nz', full_name: 'Jo Watt (again)', business_name: 'Sparks Electrical', role: 'Subcontractor', trade: 'Electrical' },
];

const res = (uid, name, extra = {}) => ({ uid, name, email: null, group: null, calendarUid: null, taskCount: 1, ...extra });

describe('normalizeName / tradeKey', () => {
  it('drops case, punctuation, Ltd/NZ and contractor words, and plurals', () => {
    expect(normalizeName('ABC Plumbing (NZ) Ltd.')).toBe('abc plumbing');
    expect(normalizeName('Roofing Contractors')).toBe('roofing');
    expect(normalizeName('Smith & Sons Limited')).toBe('smith and son');
    expect(normalizeName('Glass')).toBe('glass');
    expect(normalizeName('Ltd')).toBe('');
  });

  it('maps person trades onto CIQ trades', () => {
    expect(tradeKey('Plumber')).toBe(tradeKey('Plumbing'));
    expect(tradeKey('Electricians')).toBe(tradeKey('Electrical'));
    expect(tradeKey('Gib Stopper')).toBe(tradeKey('Gib stopping'));
    expect(tradeKey('Scaffolders')).toBe(tradeKey('Scaffolding'));
    expect(tradeKey('Plumber')).not.toBe(tradeKey('Electrical'));
    // Not in the table: falls back to the normalized name
    expect(tradeKey('Arborists')).toBe('arborist');
  });
});

describe('assignableMembers', () => {
  it('keeps members with an email, one per address, normalized', () => {
    const emails = assignableMembers(TEAM).map(m => m.user_email);
    expect(emails).toEqual(['office@abcplumbing.co.nz', 'jo@sparks.co.nz', 'kim@sparks.co.nz', 'ross@toproofs.co.nz', 'pat@ths.co.nz']);
  });
});

describe('matchResources', () => {
  const statusOf = (resource, savedMap) => matchResources([resource], TEAM, savedMap)[0];

  it('exact by email, even when the name is a trade', () => {
    const m = statusOf(res(1, 'Plumber', { email: 'office@abcplumbing.co.nz' }));
    expect(m.status).toBe('exact');
    expect(m.choice).toEqual({ action: 'member', email: 'office@abcplumbing.co.nz' });
  });

  it('exact by business name (Ltd ignored) or person name', () => {
    expect(statusOf(res(2, 'Top Roofs')).choice).toEqual({ action: 'member', email: 'ross@toproofs.co.nz' });
    expect(statusOf(res(2, 'Top Roofs')).status).toBe('exact');
    expect(statusOf(res(3, 'pat manager')).status).toBe('exact');
  });

  it('by trade when exactly one member has it: pre-selected but reviewed', () => {
    const m = statusOf(res(4, 'Plumbers'));
    expect(m.status).toBe('trade');
    expect(m.choice).toEqual({ action: 'member', email: 'office@abcplumbing.co.nz' });
    expect(needsReview(m)).toBe(true);
  });

  it('matches the resource Group against trade too', () => {
    expect(statusOf(res(4, 'Mike', { group: 'Roofer' })).status).toBe('trade');
  });

  it('ambiguous when a name or trade fits several members; defaults to label', () => {
    const byName = statusOf(res(5, 'Sparks Electrical'));
    expect(byName.status).toBe('ambiguous');
    expect(byName.candidates.map(c => c.user_email)).toEqual(['jo@sparks.co.nz', 'kim@sparks.co.nz']);
    expect(byName.choice).toEqual({ action: 'label' });
    expect(statusOf(res(6, 'Electrician')).status).toBe('ambiguous');
  });

  it('unmatched: no fit, or the only fit has no email', () => {
    expect(statusOf(res(7, 'Labourer')).status).toBe('unmatched');
    expect(statusOf(res(8, 'Gib Fixers')).status).toBe('unmatched');
    expect(statusOf(res(8, 'Gib Fixers')).choice).toEqual({ action: 'label' });
  });

  it('a saved choice wins while the name and member still hold', () => {
    const saved = { 7: { name: 'Labourer', action: 'ignore' }, 4: { name: 'Plumbers', action: 'member', email: 'pat@ths.co.nz' } };
    expect(statusOf(res(7, 'Labourer'), saved)).toMatchObject({ status: 'saved', choice: { action: 'ignore' } });
    expect(statusOf(res(4, 'Plumbers'), saved)).toMatchObject({ status: 'saved', choice: { action: 'member', email: 'pat@ths.co.nz' } });
    expect(needsReview(statusOf(res(4, 'Plumbers'), saved))).toBe(false);
  });

  it('re-matches when the saved resource was renamed or its member left the team', () => {
    expect(statusOf(res(7, 'General hand'), { 7: { name: 'Labourer', action: 'ignore' } }).status).toBe('unmatched');
    expect(statusOf(res(4, 'Plumbers'), { 4: { name: 'Plumbers', action: 'member', email: 'gone@x.co.nz' } }).status).toBe('trade');
  });

  it('handles a file mixing companies and trades', () => {
    const statuses = matchResources(
      [res(1, 'ABC Plumbing Ltd'), res(2, 'Roofer'), res(3, 'Electrician'), res(4, 'Builder')],
      TEAM,
    ).map(m => m.status);
    expect(statuses).toEqual(['exact', 'trade', 'ambiguous', 'unmatched']);
  });
});

describe('resolveAssignees', () => {
  const resources = [res(1, 'Plumber'), res(2, 'Plumbing'), res(5, 'Builder'), res(9, 'Labour')];
  const choices = new Map([
    [1, { action: 'member', email: 'office@abcplumbing.co.nz' }],
    [2, { action: 'member', email: 'Office@ABCPlumbing.co.nz' }],
    [5, { action: 'label' }],
    [9, { action: 'ignore' }],
  ]);
  const task = (name, assignments) => ({ name, mspdi_uid: 1, _mspAssignments: assignments });

  const [unassigned, multi, ignoredOnly, duplicate] = resolveAssignees([
    task('Unassigned', []),
    task('Pre-line', [{ resourceUid: 1, units: 1 }, { resourceUid: 5, units: 0.5 }, { resourceUid: 9, units: 1 }]),
    task('Clean up', [{ resourceUid: 9, units: 1 }]),
    task('Rough-in', [{ resourceUid: 1, units: 1 }, { resourceUid: 2, units: 1 }]),
  ], resources, choices, TEAM);

  it('a task with no assignments gets an empty list (the file wins)', () => {
    expect(unassigned.assignees).toEqual([]);
  });

  it("names members by business and labels by resource; ignored ones dropped", () => {
    expect(multi.assignees).toEqual([
      { name: 'ABC Plumbing', email: 'office@abcplumbing.co.nz', msp_resource_uid: 1, units: 1 },
      { name: 'Builder', email: null, msp_resource_uid: 5, units: 0.5 },
    ]);
  });

  it('leaves a task whose only resources are ignored untouched', () => {
    expect('assignees' in ignoredOnly).toBe(false);
  });

  it('two resources mapped to one member give one assignee', () => {
    expect(duplicate.assignees).toHaveLength(1);
  });

  it('does not mutate its input', () => {
    const input = [task('X', [])];
    resolveAssignees(input, resources, choices, TEAM);
    expect('assignees' in input[0]).toBe(false);
  });
});

describe('assigneesKey', () => {
  it('ignores order, units, case and resource UIDs', () => {
    const a = [{ name: 'ABC Plumbing', email: 'Office@abcplumbing.co.nz', units: 1 }, { name: 'Builder', email: null }];
    const b = [{ name: 'builder', email: null, msp_resource_uid: 7 }, { name: 'Other name', email: 'office@abcplumbing.co.nz', units: 0.5 }];
    expect(assigneesKey(a)).toBe(assigneesKey(b));
    expect(assigneesKey([])).toBe(assigneesKey(undefined));
    expect(assigneesKey(a)).not.toBe(assigneesKey([a[0]]));
  });
});

describe('buildResourceMap', () => {
  it("lays this file's choices over the saved map, keyed by UID", () => {
    const map = buildResourceMap(
      { 3: { name: 'Old resource', action: 'ignore' }, 1: { name: 'Plumber', action: 'label' } },
      [res(1, 'Plumber'), res(5, 'Builder')],
      new Map([[1, { action: 'member', email: 'Office@ABCPlumbing.co.nz' }], [5, { action: 'label' }]]),
    );
    expect(map).toEqual({
      1: { name: 'Plumber', action: 'member', email: 'office@abcplumbing.co.nz' },
      3: { name: 'Old resource', action: 'ignore' },
      5: { name: 'Builder', action: 'label' },
    });
  });
});
