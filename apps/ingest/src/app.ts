import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  MAX_ENVELOPE_BYTES,
  MAX_ENVELOPE_STRUCTURE_DEPTH,
  MAX_EVENT_BYTES,
  isJsonDepthWithin,
  serializedByteLength,
  validateEnvelope,
} from '@spectro/protocol';

import { InMemoryEventStore, type EventStore } from './store.js';
import type { IngestWriteKeyAuthorizer } from './write-key-authorizer.js';

export interface IngestAppOptions {
  apiKey?: string;
  writeKeyAuthorizer?: IngestWriteKeyAuthorizer;
  allowedOrigins?: string[];
  logger?: boolean;
  store?: EventStore;
}

export function createIngestApp(options: IngestAppOptions): FastifyInstance {
  if ((options.apiKey === undefined) === (options.writeKeyAuthorizer === undefined)) {
    throw new Error('Configure exactly one ingestion key authorizer');
  }
  const app = Fastify({
    bodyLimit: MAX_ENVELOPE_BYTES,
    logger: options.logger ?? false,
  });
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://localhost:5173']);
  const store = options.store ?? new InMemoryEventStore();

  void app.register(cors, {
    origin:
      options.writeKeyAuthorizer === undefined
        ? (origin, callback) => {
            if (!origin || allowedOrigins.has(origin)) {
              callback(null, true);
              return;
            }
            callback(null, false);
          }
        : true,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-spectro-key'],
  });

  app.get('/health', async () => ({ service: 'spectro-ingest', status: 'ok' }));

  app.post<{ Body: unknown; Headers: { 'x-spectro-key'?: string } }>(
    '/v1/envelope',
    async (request, reply) => {
      const submittedKey = request.headers['x-spectro-key'];
      if (typeof submittedKey !== 'string' || submittedKey.length > 128) {
        return reply.code(401).send({
          error: { code: 'unauthorized', message: 'A valid Spectro project key is required.' },
        });
      }

      let grant: Awaited<ReturnType<IngestWriteKeyAuthorizer['authorize']>> | undefined;
      if (options.writeKeyAuthorizer !== undefined) {
        try {
          grant = await options.writeKeyAuthorizer.authorize(submittedKey);
        } catch {
          request.log.error({ code: 'key_lookup_unavailable' }, 'project key lookup failed');
          return reply.code(503).send({
            error: {
              code: 'authorization_unavailable',
              message: 'Ingestion authorization is temporarily unavailable.',
            },
          });
        }
        if (grant === undefined) {
          return reply.code(401).send({
            error: { code: 'unauthorized', message: 'A valid Spectro project key is required.' },
          });
        }
        const origin = request.headers.origin;
        if (
          grant.allowedOrigins.length > 0 &&
          (origin === undefined || !grant.allowedOrigins.includes(origin))
        ) {
          return reply.code(403).send({
            error: {
              code: 'origin_denied',
              message: 'This origin is not allowed for the project key.',
            },
          });
        }
      } else if (submittedKey !== options.apiKey) {
        return reply.code(401).send({
          error: { code: 'unauthorized', message: 'A valid Spectro project key is required.' },
        });
      }

      if (!isJsonDepthWithin(request.body, MAX_ENVELOPE_STRUCTURE_DEPTH)) {
        return reply.code(400).send({
          error: {
            code: 'invalid_nesting',
            message: 'The envelope exceeds the maximum structural depth.',
          },
        });
      }

      if (serializedByteLength(request.body) > MAX_ENVELOPE_BYTES) {
        return reply.code(413).send({
          error: { code: 'envelope_too_large', message: 'The envelope exceeds the 1 MiB limit.' },
        });
      }

      const validation = validateEnvelope(request.body);
      if (!validation.success) {
        return reply.code(400).send({
          error: {
            code: 'invalid_envelope',
            message: 'The envelope does not match Spectro Protocol V1.',
            issues: validation.issues,
          },
        });
      }

      const oversizedEvent = validation.data.items.find(
        (item) => serializedByteLength(item.payload) > MAX_EVENT_BYTES,
      );
      if (oversizedEvent) {
        return reply.code(413).send({
          error: { code: 'event_too_large', message: 'An event exceeds the 64 KiB limit.' },
        });
      }

      if (
        grant !== undefined &&
        validation.data.items.some(
          ({ payload }) =>
            payload.context.project.id !== grant.projectId ||
            payload.context.environment !== grant.environment,
        )
      ) {
        return reply.code(403).send({
          error: {
            code: 'project_scope_mismatch',
            message: 'Every event must match the project and environment of its write key.',
          },
        });
      }

      try {
        await store.append(validation.data);
      } catch {
        request.log.error({ code: 'admission_unavailable' }, 'durable admission failed');
        return reply.code(503).send({
          error: {
            code: 'admission_unavailable',
            message: 'Durable event admission is temporarily unavailable.',
          },
        });
      }
      return reply.code(202).send({ accepted: validation.data.items.length });
    },
  );

  return app;
}
