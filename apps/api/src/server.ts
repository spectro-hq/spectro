import { createClient } from '@clickhouse/client';
import postgres from 'postgres';

import { createApiApp } from './app.js';
import { createLocalProjectAuthorizer } from './auth.js';
import { ManagedOidcProvider, type HostedAuthOptions } from './hosted-auth.js';
import { PostgresAuthControlPlane } from './postgres-auth-control-plane.js';
import { PostgresWorkspaceStore } from './postgres-workspaces.js';
import { PostgresProjectWriteKeyStore } from './postgres-project-write-keys.js';
import { ClickHouseEventQueryStore } from './clickhouse-events.js';
import { ClickHouseLiveEventStore } from './clickhouse-live.js';
import { ClickHouseIssueQueryStore } from './clickhouse-issues.js';
import { ClickHouseNetworkQueryStore } from './clickhouse-network.js';
import { ClickHousePerformanceQueryStore } from './clickhouse-performance.js';
import { ClickHouseReleaseQueryStore } from './clickhouse-releases.js';
import { createPostgresIssueLifecycleStore } from './postgres-issue-lifecycle.js';

const clickhouse = createClient({
  url: process.env.SPECTRO_CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.SPECTRO_CLICKHOUSE_USER ?? 'spectro',
  password: process.env.SPECTRO_CLICKHOUSE_PASSWORD ?? 'spectro_local',
  database: process.env.SPECTRO_CLICKHOUSE_DATABASE ?? 'spectro',
});
const issueLifecycleStore = createPostgresIssueLifecycleStore(process.env);
const authMode = process.env.SPECTRO_AUTH_MODE;
if (authMode !== undefined && authMode !== 'local' && authMode !== 'hosted') {
  throw new Error('SPECTRO_AUTH_MODE must be local or hosted');
}
if (process.env.NODE_ENV === 'production' && authMode !== 'hosted') {
  throw new Error('Production requires hosted authentication');
}
if (authMode === 'local' && process.env.NODE_ENV === 'production') {
  throw new Error('Local authentication cannot run in production');
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required authentication configuration: ${name}`);
  return value;
}

const controlPlaneSql =
  authMode === 'hosted' ? postgres(required('SPECTRO_POSTGRES_URL'), { max: 10 }) : undefined;
const configuredIngestionEndpoint = process.env.SPECTRO_INGEST_PUBLIC_ENDPOINT;
const ingestionEndpoint =
  authMode !== 'hosted'
    ? undefined
    : (configuredIngestionEndpoint ??
      (process.env.NODE_ENV === 'production'
        ? required('SPECTRO_PUBLIC_ORIGIN') === 'https://localhost:5188'
          ? 'https://localhost:5188/ingest'
          : required('SPECTRO_INGEST_PUBLIC_ENDPOINT')
        : 'http://localhost:4401'));
if (ingestionEndpoint !== undefined) {
  const parsedIngestionEndpoint = new URL(ingestionEndpoint);
  if (
    parsedIngestionEndpoint.protocol !== 'https:' &&
    !(process.env.NODE_ENV !== 'production' && parsedIngestionEndpoint.protocol === 'http:')
  ) {
    throw new Error('SPECTRO_INGEST_PUBLIC_ENDPOINT must use HTTPS in production');
  }
  if (
    parsedIngestionEndpoint.username ||
    parsedIngestionEndpoint.password ||
    parsedIngestionEndpoint.search ||
    parsedIngestionEndpoint.hash
  ) {
    throw new Error('SPECTRO_INGEST_PUBLIC_ENDPOINT must not contain credentials or query data');
  }
}
const controlPlane =
  controlPlaneSql === undefined ? undefined : new PostgresAuthControlPlane(controlPlaneSql);
const hostedAuth: HostedAuthOptions | undefined =
  controlPlane === undefined
    ? undefined
    : {
        publicOrigin: required('SPECTRO_PUBLIC_ORIGIN'),
        csrfSecret: required('SPECTRO_AUTH_CSRF_SECRET'),
        onLoginFailure: (reason, details) => {
          const diagnostic = [
            `hosted_auth_callback_failed reason=${reason}`,
            ...(details === undefined ? [] : [`category=${details.category}`]),
            ...(details?.oauthErrorCode === undefined
              ? []
              : [`oauth_error=${details.oauthErrorCode}`]),
            ...(details?.httpStatus === undefined ? [] : [`http_status=${details.httpStatus}`]),
          ].join(' ');
          process.stderr.write(`${diagnostic}\n`);
        },
        oidc: new ManagedOidcProvider({
          issuer: required('SPECTRO_OIDC_ISSUER'),
          clientId: required('SPECTRO_OIDC_CLIENT_ID'),
          clientSecret: required('SPECTRO_OIDC_CLIENT_SECRET'),
          redirectUri: `${required('SPECTRO_PUBLIC_ORIGIN')}/v1/auth/callback`,
        }),
        controlPlane,
      };
const app = createApiApp({
  ...(controlPlaneSql === undefined
    ? {}
    : { workspaceStore: new PostgresWorkspaceStore(controlPlaneSql) }),
  ...(controlPlaneSql === undefined
    ? {}
    : { projectWriteKeyStore: new PostgresProjectWriteKeyStore(controlPlaneSql) }),
  ...(ingestionEndpoint === undefined ? {} : { ingestionEndpoint }),
  ...(hostedAuth === undefined
    ? { authorizer: createLocalProjectAuthorizer(authMode === 'local' ? process.env : {}) }
    : { hostedAuth }),
  eventStore: new ClickHouseEventQueryStore(clickhouse),
  liveStore: new ClickHouseLiveEventStore(clickhouse),
  issueStore: new ClickHouseIssueQueryStore(clickhouse),
  networkStore: new ClickHouseNetworkQueryStore(clickhouse),
  performanceStore: new ClickHousePerformanceQueryStore(clickhouse),
  releaseStore: new ClickHouseReleaseQueryStore(clickhouse),
  issueLifecycleStore,
});
app.addHook('onClose', async () => {
  await Promise.all([clickhouse.close(), issueLifecycleStore.close(), controlPlane?.close()]);
});
const port = Number(process.env.SPECTRO_API_PORT ?? 4400);
const host = process.env.SPECTRO_API_HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
