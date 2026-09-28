import { describe, expect, it } from 'vitest';

import {
  organizationRoleAllows,
  type OrganizationAction,
  type OrganizationRole,
} from './organization-permissions.js';

describe('organization permissions', () => {
  const actions: readonly OrganizationAction[] = [
    'project:read',
    'issue:write',
    'project:manage',
    'member:manage',
    'organization:delete',
  ];

  const expected: Record<OrganizationRole, readonly boolean[]> = {
    owner: [true, true, true, true, true],
    admin: [true, true, true, true, false],
    member: [true, true, false, false, false],
    viewer: [true, false, false, false, false],
  };

  it('keeps read, workflow, management, and ownership permissions separate', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(actions.map((action) => organizationRoleAllows(role, action))).toEqual(expected[role]);
    }
  });
});
