export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';

export type OrganizationAction =
  | 'project:read'
  | 'issue:write'
  | 'project:manage'
  | 'member:manage'
  | 'organization:delete';

const permittedRoles: Record<OrganizationAction, ReadonlySet<OrganizationRole>> = {
  'project:read': new Set(['owner', 'admin', 'member', 'viewer']),
  'issue:write': new Set(['owner', 'admin', 'member']),
  'project:manage': new Set(['owner', 'admin']),
  'member:manage': new Set(['owner', 'admin']),
  'organization:delete': new Set(['owner']),
};

export function organizationRoleAllows(
  role: OrganizationRole,
  action: OrganizationAction,
): boolean {
  return permittedRoles[action].has(role);
}
