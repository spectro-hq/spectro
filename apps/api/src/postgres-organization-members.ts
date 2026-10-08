import { createHash, randomBytes } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import {
  canManageMember,
  invitationEmail,
  MembershipError,
  type InvitationPreview,
  type MemberListInput,
  type MemberScope,
  type OrganizationInvitation,
  type OrganizationMember,
  type OrganizationMemberStore,
} from './organization-members.js';
import type { OrganizationRole } from './organization-permissions.js';
import type { WorkspacePage } from './workspaces.js';

interface InvitationRow {
  readonly id: string;
  readonly organization_id: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly created_at: Date;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
  readonly accepted_at: Date | null;
}
function hash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
function page<T extends { readonly id: string }>(
  rows: readonly T[],
  limit: number,
): WorkspacePage<T> {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return { data, ...(rows.length > limit && last ? { nextCursor: last.id } : {}) };
}
function summary(row: InvitationRow): OrganizationInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    status: row.accepted_at
      ? 'accepted'
      : row.revoked_at
        ? 'revoked'
        : row.expires_at.getTime() <= Date.now()
          ? 'expired'
          : 'pending',
  };
}
async function actor(
  sql: TransactionSql,
  input: MemberScope,
  manage = false,
  lock = false,
): Promise<OrganizationRole> {
  if (lock) await sql`SELECT id FROM organizations WHERE id = ${input.organizationId} FOR UPDATE`;
  const [row] = await sql<{ role: OrganizationRole }[]>`
    SELECT membership.role FROM organization_memberships membership
    JOIN console_users person ON person.id = membership.user_id
    WHERE membership.organization_id = ${input.organizationId}
      AND person.id = ${input.userId} AND person.disabled_at IS NULL
    FOR SHARE OF membership, person
  `;
  if (!row || (manage && row.role !== 'owner' && row.role !== 'admin'))
    throw new MembershipError('forbidden');
  return row.role;
}
async function audit(
  sql: TransactionSql,
  input: MemberScope,
  action: string,
  resourceId: string,
  previous: OrganizationRole | null = null,
  next: OrganizationRole | null = null,
): Promise<void> {
  await sql`INSERT INTO workspace_audit_log (organization_id, actor_id, action, resource_id, previous_role, next_role)
    VALUES (${input.organizationId}, ${input.userId}, ${action}, ${resourceId}, ${previous}, ${next})`;
}
async function protectOwner(
  sql: TransactionSql,
  organizationId: string,
  targetUserId: string,
  role: OrganizationRole,
): Promise<void> {
  if (role !== 'owner') return;
  const [other] = await sql`SELECT person.id FROM organization_memberships membership
    JOIN console_users person ON person.id = membership.user_id
    WHERE membership.organization_id = ${organizationId} AND membership.role = 'owner'
      AND person.disabled_at IS NULL AND person.id <> ${targetUserId} LIMIT 1`;
  if (!other) throw new MembershipError('last_owner');
}
async function available(sql: Sql | TransactionSql, token: string): Promise<InvitationRow> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MembershipError('invitation_unavailable');
  const [row] = await sql<InvitationRow[]>`SELECT * FROM organization_invitations
    WHERE token_hash = ${hash(token)} AND expires_at > now() AND revoked_at IS NULL AND accepted_at IS NULL`;
  if (!row) throw new MembershipError('invitation_unavailable');
  return row;
}
async function recipient(
  sql: TransactionSql,
  userId: string,
  invitation: InvitationRow,
): Promise<void> {
  const [person] = await sql<{ email: string | null; email_verified: boolean }[]>`
    SELECT email, email_verified FROM console_users WHERE id = ${userId} AND disabled_at IS NULL FOR SHARE`;
  if (!person) throw new MembershipError('forbidden');
  if (!person.email_verified || !person.email) throw new MembershipError('email_unverified');
  if (person.email.trim().toLowerCase() !== invitation.email)
    throw new MembershipError('recipient_mismatch');
}
async function preview(sql: TransactionSql, invitation: InvitationRow): Promise<InvitationPreview> {
  const [organization] = await sql<
    { name: string }[]
  >`SELECT name FROM organizations WHERE id = ${invitation.organization_id}`;
  if (!organization) throw new MembershipError('invitation_unavailable');
  return {
    organizationId: invitation.organization_id,
    organizationName: organization.name,
    role: invitation.role,
    expiresAt: invitation.expires_at.toISOString(),
  };
}

export class PostgresOrganizationMemberStore implements OrganizationMemberStore {
  constructor(readonly sql: Sql) {}

  async listMembers(input: MemberListInput): Promise<WorkspacePage<OrganizationMember>> {
    return this.sql.begin(async (sql) => {
      await actor(sql, input);
      const rows = await sql<
        OrganizationMember[]
      >`SELECT person.id, person.email, membership.role, (person.disabled_at IS NULL) AS active
        FROM organization_memberships membership JOIN console_users person ON person.id = membership.user_id
        WHERE membership.organization_id = ${input.organizationId} AND person.id > ${input.cursor ?? ''}
        ORDER BY person.id LIMIT ${input.limit + 1}`;
      return page(rows, input.limit);
    });
  }
  async listInvitations(input: MemberListInput): Promise<WorkspacePage<OrganizationInvitation>> {
    return this.sql.begin(async (sql) => {
      await actor(sql, input, true);
      const rows = await sql<
        InvitationRow[]
      >`SELECT * FROM organization_invitations WHERE organization_id = ${input.organizationId}
        AND id > ${input.cursor ?? ''} ORDER BY id LIMIT ${input.limit + 1}`;
      return page(rows.map(summary), input.limit);
    });
  }
  async createInvitation(
    input: MemberScope & { readonly email: string; readonly role: OrganizationRole },
  ): Promise<OrganizationInvitation & { readonly token: string }> {
    const email = invitationEmail.parse(input.email);
    return this.sql.begin(async (sql) => {
      const role = await actor(sql, input, true, true);
      if (!canManageMember(role, input.role)) throw new MembershipError('owner_protected');
      const [member] = await sql`SELECT person.id FROM organization_memberships membership
        JOIN console_users person ON person.id = membership.user_id
        WHERE membership.organization_id = ${input.organizationId} AND lower(person.email) = ${email} LIMIT 1`;
      if (member) throw new MembershipError('already_member');
      const [existing] =
        await sql`SELECT id FROM organization_invitations WHERE organization_id = ${input.organizationId}
        AND email = ${email} AND expires_at > now() AND revoked_at IS NULL AND accepted_at IS NULL`;
      if (existing) throw new MembershipError('invitation_exists');
      const [count] = await sql<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM organization_invitations
        WHERE organization_id = ${input.organizationId} AND expires_at > now() AND revoked_at IS NULL AND accepted_at IS NULL`;
      if ((count?.count ?? 0) >= 100) throw new MembershipError('invitation_limit');
      await sql`UPDATE organization_invitations SET revoked_at = now() WHERE organization_id = ${input.organizationId}
        AND email = ${email} AND expires_at <= now() AND revoked_at IS NULL AND accepted_at IS NULL`;
      const token = randomBytes(32).toString('base64url');
      const id = `inv_${randomBytes(16).toString('base64url')}`;
      const [row] = await sql<
        InvitationRow[]
      >`INSERT INTO organization_invitations (id, organization_id, email, role, token_hash, created_by, expires_at)
        VALUES (${id}, ${input.organizationId}, ${email}, ${input.role}, ${hash(token)}, ${input.userId}, now() + interval '7 days') RETURNING *`;
      if (!row) throw new Error('Invitation not created');
      await audit(sql, input, 'invitation.created', id, null, input.role);
      return { ...summary(row), token };
    });
  }
  async revokeInvitation(input: MemberScope & { readonly invitationId: string }): Promise<void> {
    await this.sql.begin(async (sql) => {
      const role = await actor(sql, input, true, true);
      const [row] = await sql<InvitationRow[]>`SELECT * FROM organization_invitations
        WHERE id = ${input.invitationId} AND organization_id = ${input.organizationId}`;
      if (!row) throw new MembershipError('invitation_unavailable');
      if (!canManageMember(role, row.role)) throw new MembershipError('owner_protected');
      if (row.accepted_at || row.revoked_at) return;
      await sql`UPDATE organization_invitations SET revoked_at = now() WHERE id = ${row.id}`;
      await audit(sql, input, 'invitation.revoked', row.id, row.role);
    });
  }
  async changeRole(
    input: MemberScope & {
      readonly targetUserId: string;
      readonly role: OrganizationRole;
      readonly expectedRole: OrganizationRole;
    },
  ): Promise<void> {
    await this.#mutateMember(input, input.role, input.expectedRole);
  }
  async removeMember(input: MemberScope & { readonly targetUserId: string }): Promise<void> {
    await this.#mutateMember(input);
  }
  async #mutateMember(
    input: MemberScope & { readonly targetUserId: string },
    next?: OrganizationRole,
    expected?: OrganizationRole,
  ): Promise<void> {
    await this.sql.begin(async (sql) => {
      const role = await actor(sql, input, true, true);
      const [target] = await sql<
        { role: OrganizationRole }[]
      >`SELECT role FROM organization_memberships
        WHERE organization_id = ${input.organizationId} AND user_id = ${input.targetUserId} FOR UPDATE`;
      if (!target) throw new MembershipError('membership_changed');
      if (!canManageMember(role, target.role, next)) throw new MembershipError('owner_protected');
      if (expected !== undefined && target.role !== expected)
        throw new MembershipError('membership_changed');
      if (next === target.role) return;
      await protectOwner(sql, input.organizationId, input.targetUserId, target.role);
      if (next === undefined)
        await sql`DELETE FROM organization_memberships WHERE organization_id = ${input.organizationId} AND user_id = ${input.targetUserId}`;
      else
        await sql`UPDATE organization_memberships SET role = ${next} WHERE organization_id = ${input.organizationId} AND user_id = ${input.targetUserId}`;
      await audit(
        sql,
        input,
        next === undefined ? 'member.removed' : 'member.role_changed',
        input.targetUserId,
        target.role,
        next ?? null,
      );
    });
  }
  async claimInvitation(token: string): Promise<void> {
    await available(this.sql, token);
  }
  async previewInvitation(input: {
    readonly userId: string;
    readonly token: string;
  }): Promise<InvitationPreview> {
    return this.sql.begin(async (sql) => {
      const invitation = await available(sql, input.token);
      await recipient(sql, input.userId, invitation);
      return preview(sql, invitation);
    });
  }
  async acceptInvitation(input: {
    readonly userId: string;
    readonly token: string;
  }): Promise<InvitationPreview> {
    return this.sql.begin(async (sql) => {
      const initial = await available(sql, input.token);
      await sql`SELECT id FROM organizations WHERE id = ${initial.organization_id} FOR UPDATE`;
      const invitation = await available(sql, input.token);
      await recipient(sql, input.userId, invitation);
      const [existing] =
        await sql`SELECT user_id FROM organization_memberships WHERE organization_id = ${invitation.organization_id} AND user_id = ${input.userId}`;
      if (existing) throw new MembershipError('already_member');
      await sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${invitation.organization_id}, ${input.userId}, ${invitation.role})`;
      await sql`UPDATE organization_invitations SET accepted_at = now(), accepted_by = ${input.userId} WHERE id = ${invitation.id}`;
      await audit(
        sql,
        { userId: input.userId, organizationId: invitation.organization_id },
        'invitation.accepted',
        invitation.id,
        null,
        invitation.role,
      );
      return preview(sql, invitation);
    });
  }
}
