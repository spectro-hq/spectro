import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiApp } from './app.js';
import type { HostedAuthOptions } from './hosted-auth.js';

import {
  canManageMember,
  invitationEmail,
  MembershipError,
  type OrganizationMemberStore,
} from './organization-members.js';
import type { OrganizationRole } from './organization-permissions.js';

describe('organization member policy', () => {
  it('keeps Owner authority out of Admin operations', () => {
    const roles: OrganizationRole[] = ['owner', 'admin', 'member', 'viewer'];
    for (const actor of roles)
      for (const target of roles)
        for (const next of roles) {
          expect(canManageMember(actor, target, next)).toBe(
            actor === 'owner' || (actor === 'admin' && target !== 'owner' && next !== 'owner'),
          );
        }
    expect(canManageMember('admin', 'owner')).toBe(false);
    expect(canManageMember('admin', 'viewer')).toBe(true);
  });
  it('normalizes addresses without rewriting aliases or treating email as an identity key', () => {
    expect(invitationEmail.parse(' Alice+Team@Example.com ')).toBe('alice+team@example.com');
    for (const value of ['', 'not-an-address', 'x'.repeat(321)])
      expect(invitationEmail.safeParse(value).success).toBe(false);
  });
});

const apps: ReturnType<typeof createApiApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture(configured = true) {
  const store = {
    listMembers: vi.fn<OrganizationMemberStore['listMembers']>(async () => ({ data: [] })),
    listInvitations: vi.fn<OrganizationMemberStore['listInvitations']>(async () => ({ data: [] })),
    createInvitation: vi.fn<OrganizationMemberStore['createInvitation']>(),
    revokeInvitation: vi.fn<OrganizationMemberStore['revokeInvitation']>(async () => {}),
    changeRole: vi.fn<OrganizationMemberStore['changeRole']>(async () => {}),
    removeMember: vi.fn<OrganizationMemberStore['removeMember']>(async () => {}),
    claimInvitation: vi.fn<OrganizationMemberStore['claimInvitation']>(async () => {}),
    previewInvitation: vi.fn<OrganizationMemberStore['previewInvitation']>(),
    acceptInvitation: vi.fn<OrganizationMemberStore['acceptInvitation']>(),
  };
  const auth: HostedAuthOptions = {
    publicOrigin: 'https://console.example',
    csrfSecret: 'test-secret-with-at-least-thirty-two-bytes',
    oidc: {
      authorizationUrl: async () => new URL('https://issuer.example'),
      exchange: async () => ({ issuer: 'https://issuer.example', subject: 'one' }),
    },
    controlPlane: {
      createLoginAttempt: async () => {},
      consumeLoginAttempt: async () => undefined,
      findOrCreateUser: async () => 'usr_one',
      createSession: async () => 'session',
      resolveSession: async (token) => (token === 'session' ? { userId: 'usr_one' } : undefined),
      authorizeProject: async () => undefined,
      revokeSession: async () => {},
    },
  };
  const app = createApiApp({
    hostedAuth: auth,
    ...(configured ? { organizationMemberStore: store } : {}),
  });
  apps.push(app);
  const cookie = '__Host-spectro-session=session';
  const session = await app.inject({ url: '/v1/auth/session', headers: { cookie } });
  const csrf: string = session.json().csrfToken;
  return { app, store, headers: { cookie, origin: auth.publicOrigin, 'x-csrf-token': csrf } };
}
describe('membership HTTP boundary', () => {
  it('requires live sessions and CSRF for every protected mutation', async () => {
    const { app, store, headers } = await fixture();
    const base = '/v1/organizations/org_one';
    const requests = [
      {
        method: 'POST',
        url: `${base}/invitations`,
        payload: { email: 'one@example.test', role: 'viewer' },
      },
      { method: 'DELETE', url: `${base}/invitations/inv_one` },
      {
        method: 'PATCH',
        url: `${base}/members/usr_two`,
        payload: { role: 'viewer', expectedRole: 'member' },
      },
      { method: 'DELETE', url: `${base}/members/usr_two` },
      { method: 'POST', url: '/v1/invitations/preview', payload: {} },
      { method: 'POST', url: '/v1/invitations/accept', payload: {} },
    ] as const;
    for (const request of requests) {
      // oxlint-disable-next-line no-await-in-loop -- independent session boundary matrix.
      expect((await app.inject(request)).statusCode).toBe(401);
      expect(
        // oxlint-disable-next-line no-await-in-loop -- independent CSRF boundary matrix.
        (await app.inject({ ...request, headers: { ...headers, 'x-csrf-token': 'forged' } }))
          .statusCode,
      ).toBe(403);
    }
    expect(store.changeRole).not.toHaveBeenCalled();
    expect(store.acceptInvitation).not.toHaveBeenCalled();
  });
  it('rejects malformed authority fields and pagination before calling storage', async () => {
    const { app, store, headers } = await fixture();
    for (const payload of [
      { email: 'valid@example.test', role: 'owner', userId: 'usr_forged' },
      { email: 'invalid', role: 'member' },
      { email: 'valid@example.test', role: 'superadmin' },
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- invalid input matrix.
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organizations/org_one/invitations',
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (await app.inject({ url: '/v1/organizations/org_one/members?limit=101', headers }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/v1/organizations/org_one/members/usr_two',
          headers,
          payload: { role: 'admin' },
        })
      ).statusCode,
    ).toBe(400);
    expect(store.createInvitation).not.toHaveBeenCalled();
    expect(store.listMembers).not.toHaveBeenCalled();
  });
  it('derives actor identity from the session and returns stable private failure responses', async () => {
    const { app, store, headers } = await fixture();
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/v1/organizations/org_one/members/usr_two',
          headers,
          payload: { role: 'viewer', expectedRole: 'member' },
        })
      ).statusCode,
    ).toBe(204);
    expect(store.changeRole).toHaveBeenCalledWith({
      userId: 'usr_one',
      organizationId: 'org_one',
      targetUserId: 'usr_two',
      role: 'viewer',
      expectedRole: 'member',
    });
    store.listMembers
      .mockRejectedValueOnce(new MembershipError('forbidden'))
      .mockRejectedValueOnce(new Error('private SQL and payload'));
    const denied = await app.inject({ url: '/v1/organizations/org_unknown/members', headers });
    expect(denied.statusCode).toBe(403);
    const unavailable = await app.inject({ url: '/v1/organizations/org_one/members', headers });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain('private SQL');
    expect(unavailable.headers['cache-control']).toBe('no-store');
    const missing = await fixture(false);
    expect(
      (
        await missing.app.inject({
          url: '/v1/organizations/org_one/members',
          headers: missing.headers,
        })
      ).statusCode,
    ).toBe(503);
  });
});
