import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

export function createApiApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: false });

  app.get('/health', async () => ({ service: 'spectro-api', status: 'ok' }));

  return app;
}
