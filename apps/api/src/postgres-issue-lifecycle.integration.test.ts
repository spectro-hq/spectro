import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  beforeAll(async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS issue_lifecycle (
        project_id varchar(128) NOT NULL,
        environment varchar(64) NOT NULL,
        fingerprint char(32) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{32}$'),
        status varchar(16) NOT NULL CHECK (status IN ('open', 'resolved', 'ignored')),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (project_id, environment, fingerprint)
      )
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM issue_lifecycle WHERE project_id = ${projectId}`;
    await store.close();
  });

  it('upserts and isolates lifecycle state by project and environment', async () => {
    const created = await store.set({ projectId, environment, fingerprint, status: 'resolved' });
    expect(created).toMatchObject({ fingerprint, status: 'resolved' });

    await store.set({ projectId, environment, fingerprint, status: 'ignored' });
    const records = await store.getMany({ projectId, environment, fingerprints: [fingerprint] });
    expect(records.get(fingerprint)).toMatchObject({ fingerprint, status: 'ignored' });

    const otherEnvironment = await store.getMany({
      projectId,
      environment: 'production',
      fingerprints: [fingerprint],
    });
    expect(otherEnvironment.size).toBe(0);
  });
});
