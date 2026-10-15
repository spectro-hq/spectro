import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  changeMemberRole,
  claimInvitation,
  createInvitation,
  fetchMemberPage,
  MemberRequestError,
} from './member-client.js';
import { parseSettingsSearch } from './settings-navigation.js';

afterEach(() => vi.unstubAllGlobals());
describe('member requests and Settings URL state', () => {
  it('keeps the section and workspace context shareable', () => {
    const search = parseSettingsSearch({
      organization: 'org_one',
      project: 'prj_one',
      environment: 'dev',
      range: '6h',
      source: 'live',
      section: 'members',
    });
    expect(search.section).toBe('members');
    expect(search.organization).toBe('org_one');
    expect(parseSettingsSearch({ section: 'unknown' }).section).toBe('project');
  });
  it('uses session-bound CSRF and optimistic role comparison without bearer headers', async () => {
    const mocked = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: 'usr_one', csrfToken: 'csrf' })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mocked);
    await changeMemberRole({
      organizationId: 'org_one',
      member: { id: 'usr_two', email: 'two@example.test', active: true, role: 'member' },
      role: 'viewer',
    });
    expect(mocked).toHaveBeenNthCalledWith(2, '/v1/organizations/org_one/members/usr_two', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'csrf' },
      body: JSON.stringify({ role: 'viewer', expectedRole: 'member' }),
    });
  });
  it('claims secrets in the POST body, not the request URL or browser storage', async () => {
    const mocked = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mocked);
    await claimInvitation('secret');
    expect(mocked).toHaveBeenCalledWith(
      '/v1/invitations/claim',
      expect.objectContaining({
        body: JSON.stringify({ token: 'secret' }),
        credentials: 'same-origin',
      }),
    );
  });
  it('preserves safe server error codes and validates response schemas', async () => {
    const mocked = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ userId: 'usr_one', csrfToken: 'csrf' })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 'invitation_exists', message: 'Revoke the existing invitation first.' },
          }),
          { status: 409 },
        ),
      );
    vi.stubGlobal('fetch', mocked);
    await expect(
      createInvitation({ organizationId: 'org_one', email: 'one@example.test', role: 'member' }),
    ).rejects.toEqual(
      new MemberRequestError('Revoke the existing invitation first.', 409, 'invitation_exists'),
    );
    mocked.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'usr_one', role: 'superuser' }] })),
    );
    await expect(
      fetchMemberPage({
        organizationId: 'org_one',
        kind: 'members',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/Invalid/);
  });
});
