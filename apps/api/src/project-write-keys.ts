import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireConsoleSession, type HostedAuthOptions } from './hosted-auth.js';

const projectId = z.string().regex(/^prj_[A-Za-z0-9_-]{1,120}$/);
const environment = z.string().trim().min(1).max(64);
const keyId = z.string().regex(/^key_[A-Za-z0-9_-]{1,120}$/);
const allowedOrigin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  }, 'Origins must be HTTPS origins (HTTP is allowed only for localhost).');

export const createProjectWriteKeySchema = z
  .object({
    environment,
    label: z.string().trim().min(1).max(120),
    allowedOrigins: z.array(allowedOrigin).max(20).default([]),
  })
  .strict()
  .refine((value) => new Set(value.allowedOrigins).size === value.allowedOrigins.length, {
    message: 'Origins must be unique.',
    path: ['allowedOrigins'],
  });

const keyPathSchema = z.object({ projectId, environment }).strict();
const keyIdPathSchema = z.object({ projectId, environment, keyId }).strict();

export interface ProjectWriteKeySummary {
  readonly id: string;
  readonly environment: string;
  readonly label: string;
  readonly keyHint: string;
  readonly allowedOrigins: readonly string[];
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface CreatedProjectWriteKey {
  readonly key: string;
  readonly metadata: ProjectWriteKeySummary;
}

export interface ProjectWriteKeyStore {
  list(input: {
    readonly userId: string;
    readonly projectId: string;
    readonly environment: string;
  }): Promise<readonly ProjectWriteKeySummary[]>;
  create(input: {
    readonly userId: string;
    readonly projectId: string;
    readonly environment: string;
    readonly label: string;
    readonly allowedOrigins: readonly string[];
  }): Promise<CreatedProjectWriteKey>;
  revoke(input: {
    readonly userId: string;
    readonly projectId: string;
    readonly environment: string;
    readonly keyId: string;
  }): Promise<void>;
}

export class ProjectWriteKeyAccessDeniedError extends Error {
  constructor() {
    super('Project write-key access denied');
    this.name = 'ProjectWriteKeyAccessDeniedError';
  }
}

export class ProjectWriteKeyNotFoundError extends Error {
  constructor() {
    super('Project write key not found');
    this.name = 'ProjectWriteKeyNotFoundError';
  }
}

export function registerProjectWriteKeyRoutes(
  app: FastifyInstance,
  auth: HostedAuthOptions,
  store: ProjectWriteKeyStore | undefined,
  ingestionEndpoint: string,
): void {
  const handle = async (
    request: FastifyRequest,
    reply: FastifyReply,
    action: (userId: string, keyStore: ProjectWriteKeyStore) => Promise<unknown>,
  ): Promise<unknown> => {
    const principal = await requireConsoleSession(request, reply, auth, request.method !== 'GET');
    if (principal === undefined) return;
    try {
      if (store === undefined) throw new Error('Project write-key store is not configured');
      return await action(principal.userId, store);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: { code: 'invalid_request', message: 'The project key request is invalid.' },
        });
      }
      if (error instanceof ProjectWriteKeyAccessDeniedError) {
        return reply.code(403).send({
          error: { code: 'forbidden', message: 'Project key management requires an admin role.' },
        });
      }
      if (error instanceof ProjectWriteKeyNotFoundError) {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'The project key was not found.' },
        });
      }
      return reply.code(503).send({
        error: {
          code: 'control_plane_unavailable',
          message: 'Project key management is temporarily unavailable.',
        },
      });
    }
  };

  const path = '/v1/projects/:projectId/environments/:environment/write-keys';
  app.get(path, (request, reply) =>
    handle(request, reply, async (userId, keyStore) => {
      const parsed = keyPathSchema.parse(request.params);
      const keys = await keyStore.list({ userId, ...parsed });
      return { data: keys, ingestionEndpoint };
    }),
  );
  app.post(path, { bodyLimit: 8_192 }, (request, reply) =>
    handle(request, reply, async (userId, keyStore) => {
      const parsedPath = keyPathSchema.parse(request.params);
      const body = createProjectWriteKeySchema.parse(request.body);
      if (body.environment !== parsedPath.environment) {
        throw new z.ZodError([
          {
            code: 'custom',
            path: ['environment'],
            message: 'The environment must match the request path.',
          },
        ]);
      }
      const result = await keyStore.create({
        userId,
        projectId: parsedPath.projectId,
        environment: parsedPath.environment,
        label: body.label,
        allowedOrigins: body.allowedOrigins,
      });
      return reply.code(201).send(result);
    }),
  );
  app.delete(`${path}/:keyId`, (request, reply) =>
    handle(request, reply, async (userId, keyStore) => {
      const parsed = keyIdPathSchema.parse(request.params);
      await keyStore.revoke({
        userId,
        projectId: parsed.projectId,
        environment: parsed.environment,
        keyId: parsed.keyId,
      });
      return reply.code(204).send();
    }),
  );
}
