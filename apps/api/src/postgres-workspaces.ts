import { randomBytes } from 'node:crypto';

import type { Sql, TransactionSql } from 'postgres';

import { organizationRoleAllows, type OrganizationRole } from './organization-permissions.js';
import {
  WorkspaceAccessDeniedError,
  type OrganizationSummary,
  type ProjectSummary,
  type WorkspaceListInput,
  type WorkspacePage,
  type WorkspaceStore,
} from './workspaces.js';

function page<T extends { readonly id: string }>(
  rows: readonly T[],
  limit: number,
): WorkspacePage<T> {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return { data, ...(rows.length > limit && last !== undefined ? { nextCursor: last.id } : {}) };
}

async function requireMembership(
  sql: TransactionSql,
  input: { readonly userId: string; readonly organizationId: string },
  action: 'project:read' | 'project:manage',
): Promise<void> {
  const [membership] = await sql<{ readonly role: OrganizationRole }[]>`
    SELECT membership.role FROM organization_memberships AS membership
    JOIN console_users AS person ON person.id = membership.user_id
    WHERE membership.organization_id = ${input.organizationId}
      AND person.id = ${input.userId} AND person.disabled_at IS NULL
    FOR SHARE OF membership, person
  `;
  if (membership === undefined || !organizationRoleAllows(membership.role, action)) {
    throw new WorkspaceAccessDeniedError();
  }
}

export class PostgresWorkspaceStore implements WorkspaceStore {
  readonly #sql: Sql;

  // The server owns the shared pool; this repository never closes it.
  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async listOrganizations(input: WorkspaceListInput): Promise<WorkspacePage<OrganizationSummary>> {
    const rows = await this.#sql<OrganizationSummary[]>`
      SELECT organization.id, organization.name, membership.role
      FROM organizations AS organization
      JOIN organization_memberships AS membership ON membership.organization_id = organization.id
      JOIN console_users AS person ON person.id = membership.user_id
      WHERE person.id = ${input.userId} AND person.disabled_at IS NULL
        AND organization.id > ${input.cursor ?? ''}
      ORDER BY organization.id LIMIT ${input.limit + 1}
    `;
    return page(rows, input.limit);
  }

  async createOrganization(input: {
    readonly userId: string;
    readonly name: string;
  }): Promise<OrganizationSummary> {
    return this.#sql.begin(async (sql) => {
      const [person] = await sql`
        SELECT id FROM console_users WHERE id = ${input.userId} AND disabled_at IS NULL FOR SHARE
      `;
      if (person === undefined) throw new WorkspaceAccessDeniedError();
      const id = `org_${randomBytes(16).toString('base64url')}`;
      await sql`INSERT INTO organizations (id, name) VALUES (${id}, ${input.name})`;
      await sql`
        INSERT INTO organization_memberships (organization_id, user_id, role)
        VALUES (${id}, ${input.userId}, 'owner')
      `;
      await sql`
        INSERT INTO workspace_audit_log (organization_id, actor_id, action, resource_id)
        VALUES (${id}, ${input.userId}, 'organization.created', ${id})
      `;
      return { id, name: input.name, role: 'owner' as const };
    });
  }

  async listProjects(
    input: WorkspaceListInput & { readonly organizationId: string },
  ): Promise<WorkspacePage<ProjectSummary>> {
    return this.#sql.begin(async (sql) => {
      await requireMembership(sql, input, 'project:read');
      const rows = await sql<ProjectSummary[]>`
        SELECT project.id, project.name, project.organization_id AS "organizationId",
          ARRAY(SELECT name FROM project_environments WHERE project_id = project.id ORDER BY name) AS environments
        FROM projects AS project
        WHERE project.organization_id = ${input.organizationId} AND project.id > ${input.cursor ?? ''}
        ORDER BY project.id LIMIT ${input.limit + 1}
      `;
      return page(rows, input.limit);
    });
  }

  async createProject(input: {
    readonly userId: string;
    readonly organizationId: string;
    readonly name: string;
    readonly environments: readonly string[];
  }): Promise<ProjectSummary> {
    return this.#sql.begin(async (sql) => {
      await requireMembership(sql, input, 'project:manage');
      const id = `prj_${randomBytes(16).toString('base64url')}`;
      await sql`
        INSERT INTO projects (id, organization_id, name)
        VALUES (${id}, ${input.organizationId}, ${input.name})
      `;
      await sql`
        INSERT INTO project_environments ${sql(input.environments.map((name) => ({ project_id: id, name })))}
      `;
      await sql`
        INSERT INTO workspace_audit_log (organization_id, actor_id, action, resource_id)
        VALUES (${input.organizationId}, ${input.userId}, 'project.created', ${id})
      `;
      return {
        id,
        organizationId: input.organizationId,
        name: input.name,
        environments: [...input.environments],
      };
    });
  }
}
