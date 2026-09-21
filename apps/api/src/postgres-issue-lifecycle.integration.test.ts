import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { PostgresIssueLifecycleStore } from './postgres-issue-lifecycle.js';

const sql = postgres(
  process.env.SPECTRO_POSTGRES_URL ?? 'postgres://spectro:spectro_local@127.0.0.1:5432/spectro',
  { max: 2 },
);
const store = new PostgresIssueLifecycleStore(sql);
const projectId = `prj_${randomUUID().replaceAll('-', '')}`;
const environment = 'integration';
const fingerprint = '6f87a1e0c93a4b156f87a1e0c93a4b15';

describe('PostgresIssueLifecycleStore integration', () => {
  afterAll(async () => {
    await sql`DELETE FROM issue_lifecycle_history WHERE project_id = ${projectId}`;
    await sql`DELETE FROM issue_lifecycle WHERE project_id = ${projectId}`;
    await store.close();
  });

  it('upserts and isolates lifecycle state by project and environment', async () => {
    const created = await store.set({ projectId, environment, fingerprint, status: 'resolved' });
    expect(created).toMatchObject({ fingerprint, status: 'resolved' });

    const unchanged = await store.set({
      projectId,
      environment,
      fingerprint,
      status: 'resolved',
    });
    expect(unchanged.updatedAt).toBe(created.updatedAt);
    await store.set({ projectId, environment, fingerprint, status: 'ignored', actorId: 'usr_1' });
    const records = await store.getMany({ projectId, environment, fingerprints: [fingerprint] });
    expect(records.get(fingerprint)).toMatchObject({ fingerprint, status: 'ignored' });

    const otherEnvironment = await store.getMany({
      projectId,
      environment: 'production',
      fingerprints: [fingerprint],
    });
    expect(otherEnvironment.size).toBe(0);

    const history = await store.history({ projectId, environment, fingerprint, limit: 10 });
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      fingerprint,
      previousStatus: 'resolved',
      status: 'ignored',
      actorId: 'usr_1',
    });
    expect(history[1]).toMatchObject({ fingerprint, status: 'resolved' });
    expect(history[1]).not.toHaveProperty('previousStatus');
  });
});
