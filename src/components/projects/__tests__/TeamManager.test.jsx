// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamManager from '../TeamManager';
import { Project } from '@/api/entities';

// Everything that could reach the live project row is mocked.
vi.mock('@/api/entities', () => ({
  Project: { update: vi.fn(() => Promise.resolve({})) },
  ProjectRole: {
    filter: vi.fn(() => Promise.resolve([
      { name: 'Admin', permission_role: 'admin' },
      { name: 'Site Manager', permission_role: 'internal' },
      { name: 'Client', permission_role: 'external' },
    ])),
  },
  User: { list: vi.fn(() => Promise.resolve([])) },
}));
vi.mock('@/api/supabaseClient', () => ({ invokeFunction: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/lib/activityLog', () => ({ logProjectActivity: vi.fn(() => Promise.resolve()) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/shared/PersonAutocomplete', () => ({ default: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));

describe('TeamManager edit form', () => {
  let container;
  let root;

  const renderAndEdit = async (member) => {
    const project = { id: 'p1', name: 'Test', team: [member] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TeamManager project={project} />
        </QueryClientProvider>
      );
    });
    await flush();
    const pencil = container.querySelector('svg.lucide-pencil').closest('button');
    await act(async () => { pencil.click(); });
    await flush();
  };

  // The edit form's role dropdown comes first; the add form's follows it.
  const editRoleText = () => container.querySelector('[role="combobox"]').textContent;

  const clickSave = async () => {
    const save = [...container.querySelectorAll('button')].find(b => b.textContent === 'Save');
    await act(async () => { save.click(); });
    await flush();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows and keeps a saved role that is not in the role list', async () => {
    const member = { full_name: 'Sam Pipe', role: 'Subcontractor', trade: 'Plumbing' };
    await renderAndEdit(member);

    expect(editRoleText()).toBe('Subcontractor');
    expect(container.textContent).toContain('Trade');

    await clickSave();
    expect(Project.update).toHaveBeenCalledTimes(1);
    expect(Project.update).toHaveBeenCalledWith('p1', { team: [member] });
  });

  it('shows a role that is in the list without adding a duplicate', async () => {
    const member = { full_name: 'Cam Client', role: 'Client' };
    await renderAndEdit(member);

    expect(editRoleText()).toBe('Client');

    await clickSave();
    expect(Project.update).toHaveBeenCalledWith('p1', { team: [member] });
  });

  it('opens a member with no saved role without crashing', async () => {
    await renderAndEdit({ full_name: 'No Role', role: '' });

    expect(editRoleText()).toBe('');
  });
});

describe('TeamManager groups', () => {
  let container;
  let root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (project) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TeamManager project={project} />
        </QueryClientProvider>
      );
    });
    await flush();
  };

  const headings = () => [...container.querySelectorAll('h3')].map(h => h.textContent);

  it('splits the team into THS, Client and Subcontractors', async () => {
    await render({ id: 'p1', name: 'Test', team: [
      { full_name: 'Sam Pipe', role: 'Subcontractor', trade: 'Plumbing' },
      { full_name: 'Sue Site', role: 'Site Manager' },
      { full_name: 'Cam Client', role: 'Client' },
    ] });

    expect(headings()).toEqual(['THS Team', 'Client', 'Subcontractors']);
    const sections = [...container.querySelectorAll('section')].map(s => s.textContent);
    expect(sections[0]).toContain('Sue Site');
    expect(sections[1]).toContain('Cam Client');
    expect(sections[2]).toContain('Sam Pipe');
  });

  it('says when no client has been added', async () => {
    await render({ id: 'p1', name: 'Test', client_name: 'The Smiths', team: [] });

    expect(container.textContent).toContain("The Smiths is the client on record but hasn't been added to the team yet.");
  });
});
