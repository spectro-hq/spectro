import { createClient } from '@clickhouse/client';
import { connect } from '@nats-io/transport-node';

import {
  JetStreamAdmissionSource,
  ensureJetStreamPipeline,
  observeAdmissionFailureAdvisories,
} from '@spectro/pipeline';

import { ClickHouseProcessedEventWriter } from './clickhouse.js';
import { EventProcessor } from './processor.js';
import { ProcessorWorker } from './worker.js';

const abortController = new AbortController();
const stop = (): void => abortController.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

const natsServers = process.env.SPECTRO_NATS_URL ?? 'nats://localhost:4222';
const clickhouse = createClient({
  url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
});

try {
  const connection = await connect({ servers: natsServers, name: 'spectro-processor' });
  await ensureJetStreamPipeline(connection);
  const source = await JetStreamAdmissionSource.create(connection);
  const processor = new EventProcessor(new ClickHouseProcessedEventWriter(clickhouse));
  const worker = new ProcessorWorker(source, processor, 1_000, (notice) => {
    process.stderr.write(
      `${JSON.stringify({ service: 'spectro-processor', code: 'processing_retry_scheduled', ...notice })}\n`,
    );
  });
  void observeAdmissionFailureAdvisories(connection, (advisory) => {
    process.stderr.write(
      `${JSON.stringify({ service: 'spectro-processor', code: 'admission_delivery_failed', ...advisory })}\n`,
    );
  }).catch(() => {
    if (!abortController.signal.aborted) {
      process.stderr.write(
        `${JSON.stringify({ service: 'spectro-processor', code: 'advisory_monitor_unavailable' })}\n`,
      );
    }
  });

  while (!abortController.signal.aborted) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- pull consumption is intentionally sequential per worker.
      await worker.runOnce(1_000);
    } catch {
      process.stderr.write(
        `${JSON.stringify({ service: 'spectro-processor', code: 'processor_iteration_failed' })}\n`,
      );
    }
  }

  await connection.drain();
} catch (error) {
  process.stderr.write(
    `spectro-processor failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
  );
  process.exitCode = 1;
} finally {
  await clickhouse.close();
}
