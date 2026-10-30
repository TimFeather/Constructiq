import { describe, it, expect, vi, beforeEach } from 'vitest';

// A session ended server-side leaves this tab with an unexpired access token:
// table reads keep working, but every edge function's auth.getUser() fails with
// 401. invokeFunction must refresh-and-retry when it can, and otherwise sign the
// user out with a clear message instead of surfacing a bare "Unauthorized".

const client = vi.hoisted(() => ({
  functions: { invoke: vi.fn() },
  auth: {
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => client,
  isAuthApiError: (e) => e?.name === 'AuthApiError',
}));

import { invokeFunction, SESSION_EXPIRED_MESSAGE } from '../supabaseClient.js';

const assign = vi.fn();
vi.stubGlobal('window', { location: { assign } });

const ok = (data) => ({ data, error: null });
const unauthorized = () => ({
  data: null,
  error: {
    message: 'Edge Function returned a non-2xx status code',
    context: { status: 401, json: async () => ({ error: 'Unauthorized' }) },
  },
});
const SESSION = { access_token: 'a', refresh_token: 'r' };
const refusal = { name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found' };

beforeEach(() => {
  vi.clearAllMocks();
  client.auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
});

describe('invokeFunction on 401', () => {
  it('refreshes the session and retries once', async () => {
    client.functions.invoke.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok({ sent: true }));
    client.auth.refreshSession.mockResolvedValue({ data: { session: SESSION }, error: null });

    await expect(invokeFunction('invitationService', { action: 'resend' })).resolves.toEqual({ data: { sent: true } });
    expect(client.functions.invoke).toHaveBeenCalledTimes(2);
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('signs out and sends the user to login when Supabase refuses the refresh', async () => {
    client.functions.invoke.mockResolvedValue(unauthorized());
    client.auth.refreshSession.mockResolvedValue({ data: { session: null }, error: refusal });

    await expect(invokeFunction('invitationService', {})).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(client.functions.invoke).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(assign).toHaveBeenCalledWith('/login?expired=1');
  });

  it('keeps the session when the refresh fails for network reasons', async () => {
    client.functions.invoke.mockResolvedValue(unauthorized());
    client.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' },
    });

    await expect(invokeFunction('invitationService', {})).rejects.toThrow('Unauthorized');
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('leaves logged-out callers alone (public tender pages)', async () => {
    client.functions.invoke.mockResolvedValue(unauthorized());
    client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(invokeFunction('tenderPublicApi', {})).rejects.toThrow('Unauthorized');
    expect(client.auth.refreshSession).not.toHaveBeenCalled();
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('refreshes once for several calls that fail together', async () => {
    client.functions.invoke
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValue(ok({ sent: true }));
    let release;
    client.auth.refreshSession.mockReturnValue(new Promise((r) => { release = r; }));

    const calls = [invokeFunction('resendInvitation', {}), invokeFunction('resendInvitation', {})];
    await vi.waitFor(() => expect(client.auth.refreshSession).toHaveBeenCalled());
    release({ data: { session: SESSION }, error: null });

    await expect(Promise.all(calls)).resolves.toEqual([{ data: { sent: true } }, { data: { sent: true } }]);
    expect(client.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does not touch the session for other errors', async () => {
    client.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: 'x', context: { status: 403, json: async () => ({ error: 'Forbidden' }) } },
    });

    await expect(invokeFunction('invitationService', {})).rejects.toThrow('Forbidden');
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });
});
