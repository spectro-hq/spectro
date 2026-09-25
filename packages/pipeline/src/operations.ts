import { jetstreamManager, type Advisory } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/transport-node';

import { ADMITTED_STREAM, PROCESSOR_CONSUMER } from './admission.js';

export interface AdmissionPipelineSnapshot {
  streamStoredMessages: number;
  streamBytes: number;
  streamMaxBytes: number;
  oldestStoredMessageAt: string | null;
  lostBytes: number;
  consumerPending: number;
  consumerAckPending: number;
  consumerRedelivered: number;
  consumerMaxDeliver: number | null;
  consumerDeliveredSequence: number;
  consumerAcknowledgedSequence: number;
}

interface StreamStateSample {
  state: {
    messages: number;
    bytes: number;
    first_ts: string;
    lost?: { bytes: number };
  };
  config: { max_bytes: number };
}

interface ConsumerStateSample {
  num_pending: number;
  num_ack_pending: number;
  num_redelivered: number;
  config: { max_deliver?: number };
  delivered: { stream_seq: number };
  ack_floor: { stream_seq: number };
}

export function summarizeAdmissionPipeline(
  stream: StreamStateSample,
  consumer: ConsumerStateSample,
): AdmissionPipelineSnapshot {
  return {
    streamStoredMessages: stream.state.messages,
    streamBytes: stream.state.bytes,
    streamMaxBytes: stream.config.max_bytes,
    oldestStoredMessageAt: stream.state.messages > 0 ? stream.state.first_ts : null,
    lostBytes: stream.state.lost?.bytes ?? 0,
    consumerPending: consumer.num_pending,
    consumerAckPending: consumer.num_ack_pending,
    consumerRedelivered: consumer.num_redelivered,
    consumerMaxDeliver: consumer.config.max_deliver ?? null,
    consumerDeliveredSequence: consumer.delivered.stream_seq,
    consumerAcknowledgedSequence: consumer.ack_floor.stream_seq,
  };
}

export async function readAdmissionPipelineSnapshot(
  connection: NatsConnection,
): Promise<AdmissionPipelineSnapshot> {
  const manager = await jetstreamManager(connection);
  const [stream, consumer] = await Promise.all([
    manager.streams.info(ADMITTED_STREAM),
    manager.consumers.info(ADMITTED_STREAM, PROCESSOR_CONSUMER),
  ]);
  return summarizeAdmissionPipeline(stream, consumer);
}

export interface AdmissionFailureAdvisory {
  kind: 'max_deliver' | 'terminated';
  stream: typeof ADMITTED_STREAM;
  consumer: typeof PROCESSOR_CONSUMER;
  streamSequence: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function summarizeAdmissionFailureAdvisory(
  advisory: Advisory,
): AdmissionFailureAdvisory | undefined {
  if (advisory.kind !== 'max_deliver' && advisory.kind !== 'terminated') return undefined;
  if (!isRecord(advisory.data)) return undefined;
  const { stream, consumer, stream_seq: sequence } = advisory.data;
  if (stream !== ADMITTED_STREAM || consumer !== PROCESSOR_CONSUMER) return undefined;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) {
    return undefined;
  }
  return {
    kind: advisory.kind,
    stream,
    consumer,
    streamSequence: sequence,
  };
}

export async function observeAdmissionFailureAdvisories(
  connection: NatsConnection,
  onAdvisory: (advisory: AdmissionFailureAdvisory) => void,
): Promise<void> {
  const manager = await jetstreamManager(connection);
  for await (const advisory of manager.advisories()) {
    const failure = summarizeAdmissionFailureAdvisory(advisory);
    if (failure !== undefined) onAdvisory(failure);
  }
}
