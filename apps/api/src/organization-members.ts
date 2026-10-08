import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireConsoleSession, type HostedAuthOptions } from './hosted-auth.js';
import type { OrganizationRole } from './organization-permissions.js';
import type { WorkspacePage } from './workspaces.js';

export const memberRole = z.enum(['owner', 'admin', 'member', 'viewer']);
export const invitationEmail = z.string().trim().toLowerCase().max(320).email();
const organizationId = z.string().regex(/^org_[A-Za-z0-9_-]{1,120}$/);
const userId = z.string().regex(/^usr_[A-Za-z0-9_-]{1,120}$/);
const invitationId = z.string().regex(/^inv_[A-Za-z0-9_-]{1,120}$/);
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const pathSchema = z.object({ organizationId }).strict();
const memberPath = z.object({ organizationId, userId }).strict();
const invitationPath = z.object({ organizationId, invitationId }).strict();
const pagination = (cursor: z.ZodString) =>
  z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: cursor.optional(),
    })
    .strict();
const createSchema = z.object({ email: invitationEmail, role: memberRole }).strict();
const roleSchema = z.object({ role: memberRole, expectedRole: memberRole }).strict();
const INVITATION_COOKIE = '__Host-spectro-invitation';

export interface OrganizationMember {
  readonly id: string;
  readonly email: string | null;
  readonly role: OrganizationRole;
  readonly active: boolean;
}
export interface OrganizationInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'expired' | 'revoked' | 'accepted';
}
export interface InvitationPreview {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: OrganizationRole;
  readonly expiresAt: string;
}
export interface MemberScope {
  readonly userId: string;
  readonly organizationId: string;
}
export interface MemberListInput extends MemberScope {
  readonly limit: number;
  readonly cursor?: string | undefined;
}
export interface OrganizationMemberStore {
  listMembers(input: MemberListInput): Promise<WorkspacePage<OrganizationMember>>;
  listInvitations(input: MemberListInput): Promise<WorkspacePage<OrganizationInvitation>>;
  createInvitation(
    input: MemberScope & { readonly email: string; readonly role: OrganizationRole },
  ): Promise<OrganizationInvitation & { readonly token: string }>;
  revokeInvitation(input: MemberScope & { readonly invitationId: string }): Promise<void>;
  changeRole(
    input: MemberScope & {
      readonly targetUserId: string;
      readonly role: OrganizationRole;
      readonly expectedRole: OrganizationRole;
    },
  ): Promise<void>;
  removeMember(input: MemberScope & { readonly targetUserId: string }): Promise<void>;
  claimInvitation(token: string): Promise<void>;
  previewInvitation(input: {
    readonly userId: string;
    readonly token: string;
  }): Promise<InvitationPreview>;
  acceptInvitation(input: {
    readonly userId: string;
    readonly token: string;
  }): Promise<InvitationPreview>;
}

const failures = {
  forbidden: [403, 'Access to this organization is denied.'],
  owner_protected: [403, 'Only an Owner can manage Owner membership or invitations.'],
  last_owner: [409, 'Keep at least one active Owner. Add another Owner before making this change.'],
  membership_changed: [409, 'This membership changed. Refresh the list and try again.'],
  already_member: [409, 'This account is already a member. Its role has not been changed.'],
  invitation_exists: [
    409,
    'A pending invitation already exists for this email. Revoke it before creating another.',
  ],
  invitation_limit: [
    409,
    'This workspace has 100 pending invitations. Revoke unused invitations first.',
  ],
  invitation_unavailable: [
    410,
    'This invitation is expired, revoked, already used, or unavailable. Ask an admin for a new link.',
  ],
  email_unverified: [403, 'Verify your email, then sign out and sign in again before joining.'],
  recipient_mismatch: [403, 'Sign in with the email address this invitation was sent to.'],
} as const;
export class MembershipError extends Error {
  constructor(readonly code: keyof typeof failures) {
    super(failures[code][1]);
  }
}
export function canManageMember(
  actor: OrganizationRole,
  target: OrganizationRole,
  next?: OrganizationRole,
): boolean {
  return actor === 'owner' || (actor === 'admin' && target !== 'owner' && next !== 'owner');
}

export function registerOrganizationMemberRoutes(
  app: FastifyInstance,
  auth: HostedAuthOptions,
  store: OrganizationMemberStore | undefined,
): void {
  function failure(reply: FastifyReply, error: unknown): unknown {
    if (error instanceof MembershipError) {
      return reply
        .code(failures[error.code][0])
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: { code: 'invalid_request', message: 'The membership request is invalid.' },
      });
    return reply.code(503).send({
      error: {
        code: 'control_plane_unavailable',
        message: 'Team management is temporarily unavailable.',
      },
    });
  }
  async function handle(
    request: FastifyRequest,
    reply: FastifyReply,
    action: (userId: string, members: OrganizationMemberStore) => Promise<unknown>,
  ): Promise<unknown> {
    const principal = await requireConsoleSession(request, reply, auth, request.method !== 'GET');
    if (principal === undefined) return;
    try {
      if (store === undefined) throw new Error('Membership store unavailable');
      return await action(principal.userId, store);
    } catch (error) {
      return failure(reply, error);
    }
  }
  app.get('/v1/organizations/:organizationId/members', (request, reply) =>
    handle(request, reply, (actor, members) => {
      const path = pathSchema.parse(request.params);
      return members.listMembers({
        userId: actor,
        ...path,
        ...pagination(userId).parse(request.query),
      });
    }),
  );
  app.get('/v1/organizations/:organizationId/invitations', (request, reply) =>
    handle(request, reply, (actor, members) => {
      const path = pathSchema.parse(request.params);
      return members.listInvitations({
        userId: actor,
        ...path,
        ...pagination(invitationId).parse(request.query),
      });
    }),
  );
  app.post('/v1/organizations/:organizationId/invitations', { bodyLimit: 8192 }, (request, reply) =>
    handle(request, reply, async (actor, members) => {
      const result = await members.createInvitation({
        userId: actor,
        ...pathSchema.parse(request.params),
        ...createSchema.parse(request.body),
      });
      const { token, ...invitation } = result;
      const link = new URL('/invite', auth.publicOrigin);
      link.hash = new URLSearchParams({ token }).toString();
      return reply.code(201).send({ ...invitation, link: link.href });
    }),
  );
  app.delete('/v1/organizations/:organizationId/invitations/:invitationId', (request, reply) =>
    handle(request, reply, async (actor, members) => {
      await members.revokeInvitation({ userId: actor, ...invitationPath.parse(request.params) });
      return reply.code(204).send();
    }),
  );
  app.patch(
    '/v1/organizations/:organizationId/members/:userId',
    { bodyLimit: 8192 },
    (request, reply) =>
      handle(request, reply, async (actor, members) => {
        const path = memberPath.parse(request.params);
        await members.changeRole({
          userId: actor,
          organizationId: path.organizationId,
          targetUserId: path.userId,
          ...roleSchema.parse(request.body),
        });
        return reply.code(204).send();
      }),
  );
  app.delete('/v1/organizations/:organizationId/members/:userId', (request, reply) =>
    handle(request, reply, async (actor, members) => {
      const path = memberPath.parse(request.params);
      await members.removeMember({
        userId: actor,
        organizationId: path.organizationId,
        targetUserId: path.userId,
      });
      return reply.code(204).send();
    }),
  );
  app.post('/v1/invitations/claim', { bodyLimit: 8192 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (request.headers.origin !== auth.publicOrigin)
      return reply
        .code(403)
        .send({ error: { code: 'csrf_invalid', message: 'Request verification failed.' } });
    try {
      const { token } = z.object({ token: tokenSchema }).strict().parse(request.body);
      if (store === undefined) throw new Error('Membership store unavailable');
      await store.claimInvitation(token);
      reply.setCookie(INVITATION_COOKIE, token, {
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });
      return reply.code(204).send();
    } catch (error) {
      return failure(reply, error);
    }
  });
  for (const action of ['preview', 'accept'] as const) {
    app.post(`/v1/invitations/${action}`, { bodyLimit: 8192 }, (request, reply) =>
      handle(request, reply, async (actor, members) => {
        z.object({}).strict().parse(request.body);
        const token = request.cookies[INVITATION_COOKIE];
        if (!tokenSchema.safeParse(token).success || token === undefined)
          throw new MembershipError('invitation_unavailable');
        const result = await (action === 'accept'
          ? members.acceptInvitation({ userId: actor, token })
          : members.previewInvitation({ userId: actor, token }));
        if (action === 'accept')
          reply.clearCookie(INVITATION_COOKIE, {
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
          });
        return result;
      }),
    );
  }
}
