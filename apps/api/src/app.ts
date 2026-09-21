import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  decodeEventCursor,
  eventListPathSchema,
  eventListQuerySchema,
  InvalidCursorError,
  type EventListQuery,
  type EventQueryStore,
  type ProjectAuthorizer,
} from './events.js';
import {
  decodeIssueCursor,
  encodeIssueCursor,
  InvalidIssueCursorError,
  issueListQuerySchema,
  type IssueListQuery,
  type IssueQueryStore,
  type ErrorIssueSummary,
} from './issues.js';
import {
  issueLifecycleBodySchema,
  issueLifecycleHistoryQuerySchema,
  issueLifecyclePathSchema,
  type IssueStatus,
  type IssueLifecycleStore,
} from './issue-lifecycle.js';

const denyAllProjects: ProjectAuthorizer = { authorize: async () => false };
const unavailableEventStore: EventQueryStore = {
  list: async () => {
    throw new Error('Event query store is not configured');
  },
};
const unavailableIssueStore: IssueQueryStore = {
  list: async () => {
    throw new Error('Issue query store is not configured');
  },
};
const defaultLifecycleStore: IssueLifecycleStore = {
  getMany: async () => new Map(),
  set: async () => {
    throw new Error('Issue lifecycle store is not configured');
  },
  history: async () => {
    throw new Error('Issue lifecycle store is not configured');
  },
};

export interface ApiAppOptions {
  readonly authorizer?: ProjectAuthorizer;
  readonly eventStore?: EventQueryStore;
  readonly issueStore?: IssueQueryStore;
  readonly issueLifecycleStore?: IssueLifecycleStore;
}

function validationIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): {
  path: string;
  message: string;
}[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

export function createApiApp(options: ApiAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const authorizer = options.authorizer ?? denyAllProjects;
  const eventStore = options.eventStore ?? unavailableEventStore;
  const issueStore = options.issueStore ?? unavailableIssueStore;
  const issueLifecycleStore = options.issueLifecycleStore ?? defaultLifecycleStore;
  void app.register(cors, { origin: false });

  app.get('/health', async () => ({ service: 'spectro-api', status: 'ok' }));

  app.get('/v1/projects/:projectId/events', async (request, reply) => {
    const path = eventListPathSchema.safeParse(request.params);
    if (!path.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'The request path is invalid.',
          issues: validationIssues(path.error.issues),
        },
      });
    }

    if (request.headers.authorization === undefined) {
      return reply.code(401).send({
        error: { code: 'unauthorized', message: 'Authentication is required.' },
      });
    }

    let authorized: boolean;
    try {
      authorized = await authorizer.authorize({
        authorization: request.headers.authorization,
        projectId: path.data.projectId,
      });
    } catch {
      return reply.code(503).send({
        error: {
          code: 'authorization_unavailable',
          message: 'Authorization is temporarily unavailable.',
        },
      });
    }

    if (!authorized) {
      return reply.code(403).send({
        error: { code: 'forbidden', message: 'Access to this project is denied.' },
      });
    }

    const query = eventListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_query',
          message: 'The event query is invalid.',
          issues: validationIssues(query.error.issues),
        },
      });
    }

    let eventQuery: EventListQuery;
    try {
      eventQuery = {
        projectId: path.data.projectId,
        environment: query.data.environment,
        from: query.data.from,
        to: query.data.to,
        limit: query.data.limit,
        ...(query.data.type === undefined ? {} : { type: query.data.type }),
        ...(query.data.name === undefined ? {} : { name: query.data.name }),
        ...(query.data.release === undefined ? {} : { release: query.data.release }),
        ...(query.data.sessionId === undefined ? {} : { sessionId: query.data.sessionId }),
        ...(query.data.pageId === undefined ? {} : { pageId: query.data.pageId }),
        ...(query.data.fingerprint === undefined ? {} : { fingerprint: query.data.fingerprint }),
        ...(query.data.cursor === undefined
          ? {}
          : { cursor: decodeEventCursor(query.data.cursor) }),
      };
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        return reply.code(400).send({
          error: {
            code: 'invalid_query',
            message: 'The event query is invalid.',
            issues: [{ path: 'cursor', message: 'must be a valid event cursor' }],
          },
        });
      }
      throw error;
    }

    try {
      return await eventStore.list(eventQuery);
    } catch {
      return reply.code(503).send({
        error: {
          code: 'query_unavailable',
          message: 'Event query is temporarily unavailable.',
        },
      });
    }
  });

  app.get('/v1/projects/:projectId/issues', async (request, reply) => {
    const path = eventListPathSchema.safeParse(request.params);
    if (!path.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'The request path is invalid.',
          issues: validationIssues(path.error.issues),
        },
      });
    }

    if (request.headers.authorization === undefined) {
      return reply.code(401).send({
        error: { code: 'unauthorized', message: 'Authentication is required.' },
      });
    }

    let authorized: boolean;
    try {
      authorized = await authorizer.authorize({
        authorization: request.headers.authorization,
        projectId: path.data.projectId,
      });
    } catch {
      return reply.code(503).send({
        error: {
          code: 'authorization_unavailable',
          message: 'Authorization is temporarily unavailable.',
        },
      });
    }

    if (!authorized) {
      return reply.code(403).send({
        error: { code: 'forbidden', message: 'Access to this project is denied.' },
      });
    }

    const query = issueListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_query',
          message: 'The issue query is invalid.',
          issues: validationIssues(query.error.issues),
        },
      });
    }

    let issueQuery: IssueListQuery;
    try {
      issueQuery = {
        projectId: path.data.projectId,
        environment: query.data.environment,
        from: query.data.from,
        to: query.data.to,
        limit: query.data.limit,
        ...(query.data.name === undefined ? {} : { name: query.data.name }),
        ...(query.data.release === undefined ? {} : { release: query.data.release }),
        ...(query.data.cursor === undefined
          ? {}
          : { cursor: decodeIssueCursor(query.data.cursor) }),
      };
    } catch (error) {
      if (error instanceof InvalidIssueCursorError) {
        return reply.code(400).send({
          error: {
            code: 'invalid_query',
            message: 'The issue query is invalid.',
            issues: [{ path: 'cursor', message: 'must be a valid issue cursor' }],
          },
        });
      }
      throw error;
    }

    try {
      const data: Array<ErrorIssueSummary & { status: IssueStatus; statusUpdatedAt?: string }> = [];
      let cursor = issueQuery.cursor;
      while (true) {
        // oxlint-disable-next-line no-await-in-loop -- each keyset cursor depends on the prior page.
        const page = await issueStore.list({
          ...issueQuery,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        // oxlint-disable-next-line no-await-in-loop -- lifecycle keys are determined by this page.
        const lifecycle = await issueLifecycleStore.getMany({
          projectId: issueQuery.projectId,
          environment: issueQuery.environment,
          fingerprints: page.data.map((issue) => issue.fingerprint),
        });
        for (const [index, issue] of page.data.entries()) {
          const record = lifecycle.get(issue.fingerprint);
          const enriched = {
            ...issue,
            status: record?.status ?? 'open',
            ...(record === undefined ? {} : { statusUpdatedAt: record.updatedAt }),
          };
          if (query.data.status === undefined || enriched.status === query.data.status) {
            data.push(enriched);
          }
          if (data.length === issueQuery.limit) {
            const hasMore = index < page.data.length - 1 || page.nextCursor !== undefined;
            return {
              data,
              ...(hasMore
                ? {
                    nextCursor: encodeIssueCursor({
                      lastSeen: issue.lastSeen,
                      fingerprint: issue.fingerprint,
                    }),
                  }
                : {}),
            };
          }
        }
        if (page.nextCursor === undefined) return { data };
        cursor = decodeIssueCursor(page.nextCursor);
      }
    } catch {
      return reply.code(503).send({
        error: {
          code: 'query_unavailable',
          message: 'Issue query is temporarily unavailable.',
        },
      });
    }
  });

  app.patch('/v1/projects/:projectId/issues/:fingerprint', async (request, reply) => {
    const path = issueLifecyclePathSchema.safeParse(request.params);
    if (!path.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'The request path is invalid.',
          issues: validationIssues(path.error.issues),
        },
      });
    }
    if (request.headers.authorization === undefined) {
      return reply.code(401).send({
        error: { code: 'unauthorized', message: 'Authentication is required.' },
      });
    }
    try {
      const authorized = await authorizer.authorize({
        authorization: request.headers.authorization,
        projectId: path.data.projectId,
      });
      if (!authorized) {
        return reply.code(403).send({
          error: { code: 'forbidden', message: 'Access to this project is denied.' },
        });
      }
    } catch {
      return reply.code(503).send({
        error: {
          code: 'authorization_unavailable',
          message: 'Authorization is temporarily unavailable.',
        },
      });
    }
    const body = issueLifecycleBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: {
          code: 'invalid_body',
          message: 'The issue lifecycle update is invalid.',
          issues: validationIssues(body.error.issues),
        },
      });
    }
    try {
      return await issueLifecycleStore.set({
        projectId: path.data.projectId,
        fingerprint: path.data.fingerprint,
        environment: body.data.environment,
        status: body.data.status,
      });
    } catch {
      return reply.code(503).send({
        error: {
          code: 'control_plane_unavailable',
          message: 'Issue lifecycle update is temporarily unavailable.',
        },
      });
    }
  });

  app.get('/v1/projects/:projectId/issues/:fingerprint/history', async (request, reply) => {
    const path = issueLifecyclePathSchema.safeParse(request.params);
    const query = issueLifecycleHistoryQuerySchema.safeParse(request.query);
    if (!path.success || !query.success) {
      const issues = !path.success ? path.error.issues : !query.success ? query.error.issues : [];
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'The lifecycle history request is invalid.',
          issues: validationIssues(issues),
        },
      });
    }
    if (request.headers.authorization === undefined) {
      return reply.code(401).send({
        error: { code: 'unauthorized', message: 'Authentication is required.' },
      });
    }
    let authorized: boolean;
    try {
      authorized = await authorizer.authorize({
        authorization: request.headers.authorization,
        projectId: path.data.projectId,
      });
    } catch {
      return reply.code(503).send({
        error: {
          code: 'authorization_unavailable',
          message: 'Authorization is temporarily unavailable.',
        },
      });
    }
    if (!authorized) {
      return reply.code(403).send({
        error: { code: 'forbidden', message: 'Access to this project is denied.' },
      });
    }
    try {
      return {
        data: await issueLifecycleStore.history({
          projectId: path.data.projectId,
          environment: query.data.environment,
          fingerprint: path.data.fingerprint,
          limit: query.data.limit,
        }),
      };
    } catch {
      return reply.code(503).send({
        error: {
          code: 'control_plane_unavailable',
          message: 'Issue lifecycle history is temporarily unavailable.',
        },
      });
    }
  });

  return app;
}
