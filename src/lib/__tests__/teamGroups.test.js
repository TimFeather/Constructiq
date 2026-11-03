import { describe, it, expect } from 'vitest';
import { teamGroupFor, groupTeam } from '../teamGroups.js';

// Mirrors the live project_roles table.
const roles = [
  { name: 'Admin', permission_role: 'admin' },
  { name: 'Site Manager', permission_role: 'internal' },
  { name: 'Client', permission_role: 'external' },
  { name: 'External Project Management', permission_role: 'external' },
  { name: 'THS Project Manager', permission_role: 'internal' },
];

describe('teamGroupFor', () => {
  it('uses the role list permission to spot THS staff', () => {
    expect(teamGroupFor({ role: 'THS Project Manager' }, roles)).toBe('ths');
    expect(teamGroupFor({ role: 'Site Manager' }, roles)).toBe('ths');
    expect(teamGroupFor({ role: 'Admin' }, roles)).toBe('ths');
    expect(teamGroupFor({ role: 'External Project Management' }, roles)).toBe('other');
  });

  it('puts clients and subcontractors in their own groups', () => {
    expect(teamGroupFor({ role: 'Client' }, roles)).toBe('client');
    expect(teamGroupFor({ role: 'client' }, [])).toBe('client');
    expect(teamGroupFor({ role: 'Subcontractor', trade: 'Plumbing' }, roles)).toBe('subcontractor');
  });

  it('falls back to known THS role names when the role list is unreadable', () => {
    expect(teamGroupFor({ role: 'THS Project Manager' }, [])).toBe('ths');
    expect(teamGroupFor({ role: 'Site Manager' }, [])).toBe('ths');
    expect(teamGroupFor({ role: 'Architect' }, [])).toBe('other');
  });

  it('treats a blank or missing role as other', () => {
    expect(teamGroupFor({ role: '' }, roles)).toBe('other');
    expect(teamGroupFor({}, roles)).toBe('other');
  });
});

describe('groupTeam', () => {
  const team = [
    { full_name: 'Sam Pipe', role: 'Subcontractor', trade: 'Plumbing' },
    { full_name: 'Pat PM', role: 'THS Project Manager' },
    { full_name: 'Cam Client', role: 'Client' },
    { full_name: 'No Trade', role: 'Subcontractor' },
    { full_name: 'Ada Admin', role: 'Admin' },
    { full_name: 'Eli Electric', role: 'Subcontractor', trade: 'Electrical' },
  ];

  it('returns every group in display order', () => {
    expect(groupTeam(team, roles).map(g => g.key)).toEqual(['ths', 'client', 'other', 'subcontractor']);
    expect(groupTeam(undefined, roles).every(g => g.members.length === 0)).toBe(true);
  });

  it('orders THS staff by the role list and subs by trade, no trade last', () => {
    const byKey = Object.fromEntries(groupTeam(team, roles).map(g => [g.key, g.members.map(m => m.full_name)]));
    expect(byKey.ths).toEqual(['Ada Admin', 'Pat PM']);
    expect(byKey.client).toEqual(['Cam Client']);
    expect(byKey.subcontractor).toEqual(['Eli Electric', 'Sam Pipe', 'No Trade']);
  });

  it('keeps each member\'s index into the full team', () => {
    const subs = groupTeam(team, roles).find(g => g.key === 'subcontractor').members;
    subs.forEach(m => expect(team[m.index].full_name).toBe(m.full_name));
  });
});
