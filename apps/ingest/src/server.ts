import { connect } from '@nats-io/transport-node';

import { JetStreamAdmissionSink, ensureJetStreamPipeline } from '@spectro/pipeline';

import { createIngestApp } from './app.js';

const port = Number(process.env.SPECTRO_INGEST_PORT ?? 4401);
const host = process.env.SPECTRO_INGEST_HOST ?? '0.0.0.0';
const natsServers = process.env.SPECTRO_NATS_URL ?? 'nats://localhost:4222';

try {
  const connection = await connect({ servers: natsServers, name: 'spectro-ingest' });
  await ensureJetStreamPipeline(connection);
  const app = createIngestApp({
    logger: true,
    store: new JetStreamAdmissionSink(connection),
  });
  app.addHook('onClose', async () => {
    await connection.drain();
  });
  await app.listen({ port, host });
} catch (error) {
  process.stderr.write(
    `spectro-ingest failed to start: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
}
