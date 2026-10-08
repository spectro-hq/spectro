import { z } from 'zod';

import { fetchConsoleSession } from './auth-client.js';

export const organizationRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
const member = z.object({
  id: z.string(),
  email: z.string().nullable(),
  role: organizationRoleSchema,
  active: z.boolean(),
});
const invitation = z.object({
  id: z.string(),
  email: z.string(),
  role: organizationRoleSchema,
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  status: z.enum(['pending', 'expired', 'revoked', 'accepted']),
});
const preview = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  role: organizationRoleSchema,
  expiresAt: z.string().datetime(),
});
const created = invitation.extend({ link: z.string().url() });
export type OrganizationMember = z.infer<typeof member>;
export type OrganizationInvitation = z.infer<typeof invitation>;
export type CreatedInvitation = z.infer<typeof created>;
export type InvitationPreview = z.infer<typeof preview>;
export class MemberRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}
async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  const parsed = z
    .object({ error: z.object({ code: z.string(), message: z.string() }) })
    .safeParse(await response.json().catch(() => undefined));
  throw new MemberRequestError(
    parsed.success ? parsed.data.error.message : 'Team request failed. Try again in a moment.',
    response.status,
    parsed.success ? parsed.data.error.code : 'request_failed',
  );
}
async function mutate(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
): Promise<Response> {
  const session = await fetchConsoleSession();
  return checked(
    await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
      body: JSON.stringify(body),
    }),
  );
}
export async function fetchMemberPage(input: {
  readonly organizationId: string;
  readonly kind: 'members';
  readonly cursor?: string | undefined;
  readonly signal: AbortSignal;
}): Promise<{ data: OrganizationMember[]; nextCursor?: string | undefined }>;
export async function fetchMemberPage(input: {
  readonly organizationId: string;
  readonly kind: 'invitations';
  readonly cursor?: string | undefined;
  readonly signal: AbortSignal;
}): Promise<{ data: OrganizationInvitation[]; nextCursor?: string | undefined }>;
export async function fetchMemberPage(input: {
  readonly organizationId: string;
  readonly kind: 'members' | 'invitations';
  readonly cursor?: string | undefined;
  readonly signal: AbortSignal;
}): Promise<{
  data: OrganizationMember[] | OrganizationInvitation[];
  nextCursor?: string | undefined;
}> {
  const query = new URLSearchParams({
    limit: '50',
    ...(input.cursor ? { cursor: input.cursor } : {}),
  });
  const response = await checked(
    await fetch(
      `/v1/organizations/${encodeURIComponent(input.organizationId)}/${input.kind}?${query}`,
      { credentials: 'same-origin', signal: input.signal },
    ),
  );
  const schema =
    input.kind === 'members'
      ? z.object({ data: z.array(member), nextCursor: z.string().optional() })
      : z.object({ data: z.array(invitation), nextCursor: z.string().optional() });
  return schema.parse(await response.json());
}
export async function createInvitation(input: {
  readonly organizationId: string;
  readonly email: string;
  readonly role: OrganizationRole;
}): Promise<CreatedInvitation> {
  const response = await mutate(
    `/v1/organizations/${encodeURIComponent(input.organizationId)}/invitations`,
    'POST',
    { email: input.email, role: input.role },
  );
  return created.parse(await response.json());
}
export async function revokeInvitation(input: {
  readonly organizationId: string;
  readonly invitationId: string;
}): Promise<void> {
  await mutate(
    `/v1/organizations/${encodeURIComponent(input.organizationId)}/invitations/${encodeURIComponent(input.invitationId)}`,
    'DELETE',
    {},
  );
}
export async function changeMemberRole(input: {
  readonly organizationId: string;
  readonly member: OrganizationMember;
  readonly role: OrganizationRole;
}): Promise<void> {
  await mutate(
    `/v1/organizations/${encodeURIComponent(input.organizationId)}/members/${encodeURIComponent(input.member.id)}`,
    'PATCH',
    { role: input.role, expectedRole: input.member.role },
  );
}
export async function removeMember(input: {
  readonly organizationId: string;
  readonly memberId: string;
}): Promise<void> {
  await mutate(
    `/v1/organizations/${encodeURIComponent(input.organizationId)}/members/${encodeURIComponent(input.memberId)}`,
    'DELETE',
    {},
  );
}
export async function claimInvitation(token: string): Promise<void> {
  await checked(
    await fetch('/v1/invitations/claim', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    }),
  );
}
export async function previewInvitation(): Promise<InvitationPreview> {
  const response = await mutate('/v1/invitations/preview', 'POST', {});
  return preview.parse(await response.json());
}
export async function acceptInvitation(): Promise<InvitationPreview> {
  const response = await mutate('/v1/invitations/accept', 'POST', {});
  return preview.parse(await response.json());
}
