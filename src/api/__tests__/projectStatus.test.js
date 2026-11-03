import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc } }));

const { isClosedStatus, isOpenProject, setProjectStatus } = await import('@/api/projectStatus');

describe('project status groups', () => {
  it('treats Complete and Archived as closed', () => {
    expect(isClosedStatus('Complete')).toBe(true);
    expect(isClosedStatus('Archived')).toBe(true);
    expect(isClosedStatus('Active')).toBe(false);
    expect(isClosedStatus('On Hold')).toBe(false);
  });

  it('keeps On Hold projects open', () => {
    expect(isOpenProject({ status: 'Active' })).toBe(true);
    expect(isOpenProject({ status: 'On Hold' })).toBe(true);
    expect(isOpenProject({ status: 'Complete' })).toBe(false);
    expect(isOpenProject({ status: 'Archived' })).toBe(false);
  });
});

describe('setProjectStatus', () => {
  beforeEach(() => rpc.mockReset());

  it('calls the database function', async () => {
    rpc.mockResolvedValue({ data: { id: 'p1', status: 'Complete' }, error: null });
    await expect(setProjectStatus('p1', 'Complete')).resolves.toEqual({ id: 'p1', status: 'Complete' });
    expect(rpc).toHaveBeenCalledWith('set_project_status', { p_project_id: 'p1', p_status: 'Complete' });
  });

  it('throws when the database refuses', async () => {
    const error = new Error('Only an admin can reopen a closed project');
    rpc.mockResolvedValue({ data: null, error });
    await expect(setProjectStatus('p1', 'Active')).rejects.toBe(error);
  });
});
