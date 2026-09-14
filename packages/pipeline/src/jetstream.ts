import {
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
  type Consumer,
  type JetStreamClient,
  type JetStreamManager,
  type JsMsg,
} from '@nats-io/jetstream';
import { headers, nanos, type NatsConnection } from '@nats-io/transport-node';

import { MAX_ENVELOPE_BYTES, type Envelope } from '@spectro/protocol';

import {
  ADMITTED_AT_HEADER,
  ADMITTED_STREAM,
  ADMITTED_SUBJECT,
  ENVELOPE_ID_HEADER,
  PROCESSOR_CONSUMER,
  createAdmissionMetadata,
  decodeAdmittedEnvelope,
  encodeEnvelope,
  type AdmittedEnvelope,
  type AdmissionMetadata,
} from './admission.js';

const DEFAULT_MAX_STREAM_BYTES = 10 * 1024 * 1024 * 1024;
const DEFAULT_ACK_WAIT_MS = 30_000;
const DEFAULT_DUPLICATE_WINDOW_MS = 120_000;
const DEFAULT_RETRY_BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const;

export interface JetStreamProvisionOptions {
  replicas?: number;
  maxBytes?: number;
}

export interface AdmissionSink {
  append(envelope: Envelope): Promise<void>;
}

export interface AdmissionDelivery {
  admitted: AdmittedEnvelope;
  acknowledge(): void;
  retry(delayMs?: number): void;
  terminate(): void;
}

export interface AdmissionSource {
  next(expiresMs?: number): Promise<AdmissionDelivery | undefined>;
}

function hasSubject(subjects: readonly string[] | undefined, expected: string): boolean {
  return subjects?.includes(expected) ?? false;
}

async function ensureStream(
  manager: JetStreamManager,
  options: JetStreamProvisionOptions,
): Promise<void> {
  try {
    const info = await manager.streams.info(ADMITTED_STREAM);
    if (!hasSubject(info.config.subjects, ADMITTED_SUBJECT)) {
      throw new Error(`JetStream stream ${ADMITTED_STREAM} does not own ${ADMITTED_SUBJECT}.`);
    }
    return;
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not own')) {
      throw error;
    }
  }

  await manager.streams.add({
    name: ADMITTED_STREAM,
    description: 'Validated Spectro Protocol V1 envelopes awaiting processing',
    subjects: [ADMITTED_SUBJECT],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
    discard: DiscardPolicy.New,
    max_bytes: options.maxBytes ?? DEFAULT_MAX_STREAM_BYTES,
    max_msg_size: MAX_ENVELOPE_BYTES,
    duplicate_window: nanos(DEFAULT_DUPLICATE_WINDOW_MS),
    num_replicas: options.replicas ?? 1,
  });
}

async function ensureConsumer(manager: JetStreamManager): Promise<void> {
  try {
    const info = await manager.consumers.info(ADMITTED_STREAM, PROCESSOR_CONSUMER);
    if (info.config.ack_policy !== AckPolicy.Explicit) {
      throw new Error(
        `JetStream consumer ${PROCESSOR_CONSUMER} must use explicit acknowledgements.`,
      );
    }
    return;
  } catch (error) {
    if (error instanceof Error && error.message.includes('must use explicit')) {
      throw error;
    }
  }

  await manager.consumers.add(ADMITTED_STREAM, {
    durable_name: PROCESSOR_CONSUMER,
    description: 'Spectro V1 event processor',
    filter_subject: ADMITTED_SUBJECT,
    deliver_policy: DeliverPolicy.All,
    ack_policy: AckPolicy.Explicit,
    ack_wait: nanos(DEFAULT_ACK_WAIT_MS),
    max_deliver: 10,
    max_ack_pending: 100,
    backoff: DEFAULT_RETRY_BACKOFF_MS.map(nanos),
  });
}

export async function ensureJetStreamPipeline(
  connection: NatsConnection,
  options: JetStreamProvisionOptions = {},
): Promise<void> {
  const manager = await jetstreamManager(connection);
  await ensureStream(manager, options);
  await ensureConsumer(manager);
}

export class JetStreamAdmissionSink implements AdmissionSink {
  readonly #jetstream: JetStreamClient;
  readonly #clock: () => number;

  constructor(connection: NatsConnection, clock: () => number = Date.now) {
    this.#jetstream = jetstream(connection);
    this.#clock = clock;
  }

  async append(envelope: Envelope): Promise<void> {
    const metadata = createAdmissionMetadata(envelope, this.#clock());
    const messageHeaders = headers();
    messageHeaders.set(ENVELOPE_ID_HEADER, metadata.envelopeId);
    messageHeaders.set(ADMITTED_AT_HEADER, String(metadata.admittedAt));

    const acknowledgement = await this.#jetstream.publish(
      ADMITTED_SUBJECT,
      encodeEnvelope(envelope),
      {
        msgID: metadata.envelopeId,
        headers: messageHeaders,
        expect: { streamName: ADMITTED_STREAM },
      },
    );
    if (acknowledgement.stream !== ADMITTED_STREAM) {
      throw new Error('The admitted envelope was acknowledged by an unexpected stream.');
    }
  }
}

function metadataFromMessage(message: JsMsg): AdmissionMetadata {
  const envelopeId = message.headers?.get(ENVELOPE_ID_HEADER);
  const admittedAt = Number(message.headers?.get(ADMITTED_AT_HEADER));
  if (!envelopeId) {
    throw new Error('The admitted envelope is missing its identity header.');
  }

  return { envelopeId, admittedAt };
}

class JetStreamAdmissionDelivery implements AdmissionDelivery {
  readonly admitted: AdmittedEnvelope;
  readonly #message: JsMsg;

  constructor(message: JsMsg, admitted: AdmittedEnvelope) {
    this.#message = message;
    this.admitted = admitted;
  }

  acknowledge(): void {
    this.#message.ack();
  }

  retry(delayMs?: number): void {
    this.#message.nak(delayMs);
  }

  terminate(): void {
    this.#message.term();
  }
}

export class JetStreamAdmissionSource implements AdmissionSource {
  readonly #consumer: Consumer;

  private constructor(consumer: Consumer) {
    this.#consumer = consumer;
  }

  static async create(connection: NatsConnection): Promise<JetStreamAdmissionSource> {
    const consumer = await jetstream(connection).consumers.get(ADMITTED_STREAM, PROCESSOR_CONSUMER);
    return new JetStreamAdmissionSource(consumer);
  }

  async next(expiresMs: number = 30_000): Promise<AdmissionDelivery | undefined> {
    const message = await this.#consumer.next({ expires: expiresMs });
    if (message === null) {
      return undefined;
    }

    try {
      const admitted = decodeAdmittedEnvelope(message.data, metadataFromMessage(message));
      return new JetStreamAdmissionDelivery(message, admitted);
    } catch (error) {
      message.term();
      throw error;
    }
  }
}
