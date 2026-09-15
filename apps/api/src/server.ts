import { createClient } from '@clickhouse/client';

import { createApiApp } from './app.js';
import { createLocalProjectAuthorizer } from './auth.js';
import { ClickHouseEventQueryStore } from './clickhouse-events.js';
import { ClickHouseIssueQueryStore } from './clickhouse-issues.js';

const clickhouse = createClient({
  url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
});
const app = createApiApp({
  authorizer: createLocalProjectAuthorizer(process.env),
  eventStore: new ClickHouseEventQueryStore(clickhouse),
  issueStore: new ClickHouseIssueQueryStore(clickhouse),
});
app.addHook('onClose', async () => {
  await clickhouse.close();
});
const port = Number(process.env.SPECTRO_API_PORT ?? 4400);
const host = process.env.SPECTRO_API_HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
