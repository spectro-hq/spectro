import { ClickHouseLogLevel, createClient } from '@clickhouse/client';
import { connect } from '@nats-io/transport-node';

import { readAdmissionPipelineSnapshot } from '@spectro/pipeline';

import { inspectPipelineStatus, pipelineStatusThresholdsFrom } from './operations.js';

const clickhouse = createClient({
  url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
  log: { level: ClickHouseLogLevel.OFF },
});

try {
  const status = await inspectPipelineStatus(
    {
      async readAdmissionSnapshot() {
        const connection = await connect({
          servers: process.env.SPECTRO_NATS_URL ?? 'nats://localhost:4222',
          name: 'spectro-pipeline-status',
          timeout: 3_000,
          maxReconnectAttempts: 0,
        });
        try {
          return await readAdmissionPipelineSnapshot(connection);
        } finally {
          await connection.close();
        }
      },
      async checkClickHouse() {
        const result = await clickhouse.query({ query: 'SELECT 1', format: 'JSONEachRow' });
        await result.json();
      },
    },
    pipelineStatusThresholdsFrom(process.env),
  );
  process.stdout.write(`${JSON.stringify(status)}\n`);
  if (status.status !== 'ok') process.exitCode = status.status === 'degraded' ? 1 : 2;
} catch {
  process.stdout.write(
    `${JSON.stringify({ status: 'unavailable', codes: ['invalid_status_configuration'] })}\n`,
  );
  process.exitCode = 2;
} finally {
  await clickhouse.close();
}
