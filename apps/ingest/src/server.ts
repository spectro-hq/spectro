import { connect } from '@nats-io/transport-node';
import postgres from 'postgres';

import { JetStreamAdmissionSink, ensureJetStreamPipeline } from '@spectro/pipeline';

import { createIngestApp } from './app.js';
import { ingestApiKeyFrom, ingestWriteKeyDatabaseUrlFrom } from './config.js';
import { PostgresIngestWriteKeyAuthorizer } from './postgres-write-key-authorizer.js';

const port = Number(process.env.SPECTRO_INGEST_PORT ?? 4401);
const host = process.env.SPECTRO_INGEST_HOST ?? '0.0.0.0';
const natsServers = process.env.SPECTRO_NATS_URL ?? 'nats://localhost:4222';

try {
  const writeKeyDatabaseUrl = ingestWriteKeyDatabaseUrlFrom(process.env);
  const writeKeySql =
    writeKeyDatabaseUrl === undefined
      ? undefined
      : postgres(writeKeyDatabaseUrl, { max: 10, prepare: false });
  const apiKey = writeKeySql === undefined ? ingestApiKeyFrom(process.env) : undefined;
  const connection = await connect({ servers: natsServers, name: 'spectro-ingest' });
  await ensureJetStreamPipeline(connection);
  const app = createIngestApp({
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(writeKeySql === undefined
      ? {}
      : { writeKeyAuthorizer: new PostgresIngestWriteKeyAuthorizer(writeKeySql) }),
    logger: true,
    store: new JetStreamAdmissionSink(connection),
  });
  app.addHook('onClose', async () => {
    await Promise.all([connection.drain(), writeKeySql?.end()]);
  });
  await app.listen({ port, host });
} catch (error) {
  process.stderr.write(
    `spectro-ingest failed to start: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
}
