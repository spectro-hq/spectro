import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';

import type { IngestWriteKeyAuthorizer, IngestWriteKeyGrant } from './write-key-authorizer.js';

function parseAllowedOrigins(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error('Stored project key origin policy is invalid');
  }
  return value.map((origin: unknown) => {
    if (typeof origin !== 'string') throw new Error('Stored project key origin policy is invalid');
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Stored project key origin policy is invalid');
    }
    if (
      parsed.origin !== origin ||
      (parsed.protocol !== 'https:' &&
        !(
          parsed.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
        ))
    ) {
      throw new Error('Stored project key origin policy is invalid');
    }
    return origin;
  });
}

export class PostgresIngestWriteKeyAuthorizer implements IngestWriteKeyAuthorizer {
  readonly #sql: Sql;

  // This pool should be constructed with the dedicated ingestion read-only role.
  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async authorize(key: string): Promise<IngestWriteKeyGrant | undefined> {
    if (!/^spk_[A-Za-z0-9_-]{43}$/.test(key)) return undefined;
    const verifier = createHash('sha256').update(key, 'utf8').digest();
    const sql = this.#sql;
    const [row] = await sql<
      {
        readonly project_id: string;
        readonly environment: string;
        readonly allowed_origins: unknown;
      }[]
    >`
      SELECT project_id, environment, allowed_origins
      FROM project_write_keys
      WHERE verifier = ${verifier} AND revoked_at IS NULL
      LIMIT 1
    `;
    if (row === undefined) return undefined;
    return {
      projectId: row.project_id,
      environment: row.environment,
      allowedOrigins: parseAllowedOrigins(row.allowed_origins),
    };
  }
}
