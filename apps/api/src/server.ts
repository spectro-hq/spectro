import { createApiApp } from './app.js';

const app = createApiApp();
const port = Number(process.env.SPECTRO_API_PORT ?? 4400);
const host = process.env.SPECTRO_API_HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
