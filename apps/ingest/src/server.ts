import { createIngestApp } from './app.js';

const app = createIngestApp({ logger: true });
const port = Number(process.env.SPECTRO_INGEST_PORT ?? 4401);
const host = process.env.SPECTRO_INGEST_HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
