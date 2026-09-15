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
  InvalidIssueCursorError,
  issueListQuerySchema,
  type IssueListQuery,
  type IssueQueryStore,
} from './issues.js';

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

export interface ApiAppOptions {
  readonly authorizer?: ProjectAuthorizer;
  readonly eventStore?: EventQueryStore;
  readonly issueStore?: IssueQueryStore;
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
      return await issueStore.list(issueQuery);
    } catch {
      return reply.code(503).send({
        error: {
          code: 'query_unavailable',
          message: 'Issue query is temporarily unavailable.',
        },
      });
    }
  });

  return app;
}
