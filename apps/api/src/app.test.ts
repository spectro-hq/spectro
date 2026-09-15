import { describe, expect, it } from 'vitest';

import { createApiApp } from './app.js';
import type { EventListQuery, EventQueryStore, ProjectAuthorizer } from './events.js';
import type { IssueListQuery } from './issues.js';
import type { IssueLifecycleStore } from './issue-lifecycle.js';

describe('GET /health', () => {
  it('reports the product API boundary', async () => {
    const app = createApiApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ service: 'spectro-api', status: 'ok' });
  });
});

const allowProject: ProjectAuthorizer = { authorize: async () => true };
const emptyEventStore: EventQueryStore = { list: async () => ({ data: [] }) };
const validUrl =
  '/v1/projects/prj_checkout/events?environment=production&from=1789368000000&to=1789368060000';

describe('GET /v1/projects/:projectId/events', () => {
  it('requires authentication before querying events', async () => {
    let queried = false;
    const app = createApiApp({
      authorizer: allowProject,
      eventStore: { list: async () => ((queried = true), { data: [] }) },
    });

    const response = await app.inject({ method: 'GET', url: validUrl });
    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'unauthorized', message: 'Authentication is required.' },
    });
    expect(queried).toBe(false);
  });

  it('denies a caller without access to the project', async () => {
    const app = createApiApp({
      authorizer: { authorize: async () => false },
      eventStore: emptyEventStore,
    });

    const response = await app.inject({
      method: 'GET',
      url: validUrl,
      headers: { authorization: 'Bearer wrong-project' },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: 'forbidden', message: 'Access to this project is denied.' },
    });
  });

  it('validates and forwards a bounded project query', async () => {
    let received: EventListQuery | undefined;
    const app = createApiApp({
      authorizer: allowProject,
      eventStore: {
        list: async (query) => {
          received = query;
          return { data: [] };
        },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `${validUrl}&type=error&limit=25`,
      headers: { authorization: 'Bearer local-secret' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [] });
    expect(received).toEqual({
      projectId: 'prj_checkout',
      environment: 'production',
      from: 1_789_368_000_000,
      to: 1_789_368_060_000,
      type: 'error',
      limit: 25,
    });
  });

  it('returns stable errors for invalid cursors and unavailable stores', async () => {
    const invalidCursorApp = createApiApp({
      authorizer: allowProject,
      eventStore: emptyEventStore,
    });
    const invalidCursorResponse = await invalidCursorApp.inject({
      method: 'GET',
      url: `${validUrl}&cursor=not-a-cursor`,
      headers: { authorization: 'Bearer local-secret' },
    });
    await invalidCursorApp.close();

    expect(invalidCursorResponse.statusCode).toBe(400);
    expect(invalidCursorResponse.json()).toMatchObject({
      error: { code: 'invalid_query', issues: [{ path: 'cursor' }] },
    });

    const unavailableApp = createApiApp({
      authorizer: allowProject,
      eventStore: { list: async () => Promise.reject(new Error('private database details')) },
    });
    const unavailableResponse = await unavailableApp.inject({
      method: 'GET',
      url: validUrl,
      headers: { authorization: 'Bearer local-secret' },
    });
    await unavailableApp.close();

    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toEqual({
      error: {
        code: 'query_unavailable',
        message: 'Event query is temporarily unavailable.',
      },
    });
    expect(unavailableResponse.body).not.toContain('private database details');
  });
});

const validIssueUrl =
  '/v1/projects/prj_checkout/issues?environment=production&from=1789368000000&to=1789368060000';

describe('GET /v1/projects/:projectId/issues', () => {
  it('authorizes, validates, and forwards a bounded issue query', async () => {
    let received: IssueListQuery | undefined;
    const app = createApiApp({
      authorizer: allowProject,
      issueStore: {
        list: async (query) => {
          received = query;
          return { data: [] };
        },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `${validIssueUrl}&name=runtime_error&release=web%401.4.2&limit=25`,
      headers: { authorization: 'Bearer local-secret' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(received).toEqual({
      projectId: 'prj_checkout',
      environment: 'production',
      from: 1_789_368_000_000,
      to: 1_789_368_060_000,
      name: 'runtime_error',
      release: 'web@1.4.2',
      limit: 25,
    });
  });

  it('joins lifecycle state onto derived issues', async () => {
    const fingerprint = '6f87a1e0c93a4b156f87a1e0c93a4b15';
    const app = createApiApp({
      authorizer: allowProject,
      issueStore: {
        list: async () => ({
          data: [
            {
              fingerprint,
              message: 'boom',
              occurrenceCount: 3,
              affectedSessionCount: 2,
              affectedUserCount: 1,
              firstSeen: 100,
              lastSeen: 200,
              latestEventId: 'evt_1',
            },
          ],
        }),
      },
      issueLifecycleStore: {
        getMany: async () =>
          new Map([
            [
              fingerprint,
              { fingerprint, status: 'resolved', updatedAt: '2026-09-15T13:00:00.000Z' },
            ],
          ]),
        set: async () => {
          throw new Error('not used');
        },
      },
    });
    const response = await app.inject({
      method: 'GET',
      url: validIssueUrl,
      headers: { authorization: 'Bearer local-secret' },
    });
    await app.close();
    expect(response.json()).toMatchObject({
      data: [{ fingerprint, status: 'resolved', statusUpdatedAt: '2026-09-15T13:00:00.000Z' }],
    });
  });

  it('fails before storage without authorization and hides storage errors', async () => {
    let queried = false;
    const app = createApiApp({
      authorizer: allowProject,
      issueStore: {
        list: async () => {
          queried = true;
          throw new Error('private ClickHouse details');
        },
      },
    });
    const unauthorized = await app.inject({ method: 'GET', url: validIssueUrl });
    expect(unauthorized.statusCode).toBe(401);
    expect(queried).toBe(false);

    const unavailable = await app.inject({
      method: 'GET',
      url: validIssueUrl,
      headers: { authorization: 'Bearer local-secret' },
    });
    await app.close();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: { code: 'query_unavailable', message: 'Issue query is temporarily unavailable.' },
    });
    expect(unavailable.body).not.toContain('private ClickHouse details');
  });
});

describe('PATCH /v1/projects/:projectId/issues/:fingerprint', () => {
  it('authorizes and persists an idempotent lifecycle status', async () => {
    const fingerprint = '6f87a1e0c93a4b156f87a1e0c93a4b15';
    let received: Parameters<IssueLifecycleStore['set']>[0] | undefined;
    const app = createApiApp({
      authorizer: allowProject,
      issueLifecycleStore: {
        getMany: async () => new Map(),
        set: async (input) => {
          received = input;
          return { fingerprint, status: input.status, updatedAt: '2026-09-15T13:00:00.000Z' };
        },
      },
    });
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/prj_checkout/issues/${fingerprint}`,
      headers: { authorization: 'Bearer local-secret' },
      payload: { environment: 'production', status: 'resolved' },
    });
    await app.close();
    expect(response.statusCode).toBe(200);
    expect(received).toEqual({
      projectId: 'prj_checkout',
      environment: 'production',
      fingerprint,
      status: 'resolved',
    });
  });

  it('rejects invalid status and hides control-plane failures', async () => {
    const fingerprint = '6f87a1e0c93a4b156f87a1e0c93a4b15';
    const app = createApiApp({
      authorizer: allowProject,
      issueLifecycleStore: {
        getMany: async () => new Map(),
        set: async () => Promise.reject(new Error('private postgres details')),
      },
    });
    const invalid = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/prj_checkout/issues/${fingerprint}`,
      headers: { authorization: 'Bearer local-secret' },
      payload: { environment: 'production', status: 'closed' },
    });
    expect(invalid.statusCode).toBe(400);

    const unavailable = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/prj_checkout/issues/${fingerprint}`,
      headers: { authorization: 'Bearer local-secret' },
      payload: { environment: 'production', status: 'ignored' },
    });
    await app.close();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error: {
        code: 'control_plane_unavailable',
        message: 'Issue lifecycle update is temporarily unavailable.',
      },
    });
    expect(unavailable.body).not.toContain('private postgres details');
  });
});
