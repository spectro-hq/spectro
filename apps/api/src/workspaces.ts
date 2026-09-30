import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireConsoleSession, type HostedAuthOptions } from './hosted-auth.js';
import type { OrganizationRole } from './organization-permissions.js';

const organizationId = z.string().regex(/^org_[A-Za-z0-9_-]{1,120}$/);
const projectId = z.string().regex(/^prj_[A-Za-z0-9_-]{1,120}$/);
const name = z.string().trim().min(1).max(120);
const limit = z.coerce.number().int().min(1).max(100).default(50);
const organizationPath = z.object({ organizationId }).strict();
const organizationQuery = z.object({ limit, cursor: organizationId.optional() }).strict();
const projectQuery = z.object({ limit, cursor: projectId.optional() }).strict();
export const createOrganizationSchema = z.object({ name }).strict();
export const createProjectSchema = z
  .object({
    name,
    environments: z.array(z.string().trim().min(1).max(64)).min(1).max(10),
  })
  .strict()
  .refine((value) => new Set(value.environments).size === value.environments.length, {
    message: 'Environment names must be unique.',
    path: ['environments'],
  });

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly role: OrganizationRole;
}

export interface ProjectSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly environments: readonly string[];
}

export interface WorkspacePage<T> {
  readonly data: readonly T[];
  readonly nextCursor?: string;
}

export interface WorkspaceListInput {
  readonly userId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface WorkspaceStore {
  listOrganizations(input: WorkspaceListInput): Promise<WorkspacePage<OrganizationSummary>>;
  createOrganization(input: {
    readonly userId: string;
    readonly name: string;
  }): Promise<OrganizationSummary>;
  listProjects(
    input: WorkspaceListInput & { readonly organizationId: string },
  ): Promise<WorkspacePage<ProjectSummary>>;
  createProject(input: {
    readonly userId: string;
    readonly organizationId: string;
    readonly name: string;
    readonly environments: readonly string[];
  }): Promise<ProjectSummary>;
}

export class WorkspaceAccessDeniedError extends Error {
  constructor() {
    super('Workspace access denied');
    this.name = 'WorkspaceAccessDeniedError';
  }
}

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  auth: HostedAuthOptions,
  store: WorkspaceStore | undefined,
): void {
  const handle = async (
    request: FastifyRequest,
    reply: FastifyReply,
    action: (userId: string, workspace: WorkspaceStore) => Promise<unknown>,
  ): Promise<unknown> => {
    const principal = await requireConsoleSession(request, reply, auth, request.method === 'POST');
    if (principal === undefined) return;
    try {
      if (store === undefined) throw new Error('Workspace store is not configured');
      return await action(principal.userId, store);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: { code: 'invalid_request', message: 'The workspace request is invalid.' },
        });
      }
      if (error instanceof WorkspaceAccessDeniedError) {
        return reply.code(403).send({
          error: { code: 'forbidden', message: 'Access to this organization is denied.' },
        });
      }
      return reply.code(503).send({
        error: {
          code: 'control_plane_unavailable',
          message: 'Workspace access is temporarily unavailable.',
        },
      });
    }
  };

  app.get('/v1/organizations', (request, reply) =>
    handle(request, reply, (userId, workspace) => {
      const query = organizationQuery.parse(request.query);
      return workspace.listOrganizations({
        userId,
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
    }),
  );
  app.post('/v1/organizations', { bodyLimit: 8_192 }, (request, reply) =>
    handle(request, reply, async (userId, workspace) => {
      const body = createOrganizationSchema.parse(request.body);
      const organization = await workspace.createOrganization({ userId, name: body.name });
      return reply.code(201).send(organization);
    }),
  );
  app.get('/v1/organizations/:organizationId/projects', (request, reply) =>
    handle(request, reply, (userId, workspace) => {
      const path = organizationPath.parse(request.params);
      const query = projectQuery.parse(request.query);
      return workspace.listProjects({
        userId,
        organizationId: path.organizationId,
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
    }),
  );
  app.post('/v1/organizations/:organizationId/projects', { bodyLimit: 8_192 }, (request, reply) =>
    handle(request, reply, async (userId, workspace) => {
      const path = organizationPath.parse(request.params);
      const body = createProjectSchema.parse(request.body);
      const project = await workspace.createProject({
        userId,
        organizationId: path.organizationId,
        ...body,
      });
      return reply.code(201).send(project);
    }),
  );
}
