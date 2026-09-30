import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('hosted Console API credentials', () => {
  it('recognizes only Spectro-owned hosted-login feedback flags', async () => {
    const { hasHostedLoginFailure } = await import('./auth-client.js');

    expect(hasHostedLoginFailure('?auth_error=login_failed')).toBe(true);
    expect(hasHostedLoginFailure('?auth_error=access_denied')).toBe(false);
    expect(hasHostedLoginFailure('?error_description=Email%20not%20verified')).toBe(false);
  });

  it('does not send a browser-readable bearer token in production', async () => {
    vi.stubEnv('PROD', true);
    vi.resetModules();
    const { apiReadHeaders, fetchConsoleSession } = await import('./auth-client.js');
    expect(apiReadHeaders('must-not-be-sent')).toEqual({});

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ userId: 'usr_one', csrfToken: 'csrf' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchConsoleSession()).resolves.toEqual({ userId: 'usr_one', csrfToken: 'csrf' });
    expect(fetchMock).toHaveBeenCalledWith('/v1/auth/session', { credentials: 'same-origin' });
  });

  it('attaches the session-bound CSRF token to hosted issue writes', async () => {
    vi.stubEnv('PROD', true);
    vi.resetModules();
    const { updateIssueStatus } = await import('./issue-query.js');
    const fingerprint = 'a'.repeat(32);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ userId: 'usr_one', csrfToken: 'session-csrf' })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ fingerprint, status: 'resolved', updatedAt: new Date().toISOString() }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await updateIssueStatus({
      projectId: 'prj_checkout',
      environment: 'production',
      fingerprint,
      status: 'resolved',
      token: 'must-not-be-sent',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/v1/projects/prj_checkout/issues/${fingerprint}`,
      expect.objectContaining({
        credentials: 'same-origin',
        headers: { 'x-csrf-token': 'session-csrf', 'content-type': 'application/json' },
      }),
    );
  });
});
