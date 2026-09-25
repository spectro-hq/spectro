import type { AdmissionPipelineSnapshot } from '@spectro/pipeline';

export interface PipelineStatusThresholds {
  maxStoredMessages: number;
  maxOldestMessageAgeMs: number;
  maxRedelivered: number;
}

export const DEFAULT_PIPELINE_STATUS_THRESHOLDS: PipelineStatusThresholds = {
  maxStoredMessages: 1_000,
  maxOldestMessageAgeMs: 5 * 60_000,
  maxRedelivered: 10,
};

function readThreshold(
  values: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = values[name];
  if (raw === undefined) return fallback;
  if (raw.trim() === '') throw new Error(`${name} must be a non-negative safe integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

export function pipelineStatusThresholdsFrom(
  values: Record<string, string | undefined>,
): PipelineStatusThresholds {
  return {
    maxStoredMessages: readThreshold(
      values,
      'SPECTRO_OPS_MAX_STORED_MESSAGES',
      DEFAULT_PIPELINE_STATUS_THRESHOLDS.maxStoredMessages,
    ),
    maxOldestMessageAgeMs: readThreshold(
      values,
      'SPECTRO_OPS_MAX_OLDEST_MESSAGE_AGE_MS',
      DEFAULT_PIPELINE_STATUS_THRESHOLDS.maxOldestMessageAgeMs,
    ),
    maxRedelivered: readThreshold(
      values,
      'SPECTRO_OPS_MAX_REDELIVERED',
      DEFAULT_PIPELINE_STATUS_THRESHOLDS.maxRedelivered,
    ),
  };
}

export type PipelineStatusCode =
  | 'nats_unavailable'
  | 'clickhouse_unavailable'
  | 'stream_data_lost'
  | 'stream_near_capacity'
  | 'stored_message_limit_exceeded'
  | 'oldest_message_age_exceeded'
  | 'redelivery_limit_exceeded'
  | 'invalid_oldest_message_timestamp';

export interface PipelineStatus {
  status: 'ok' | 'degraded' | 'unavailable';
  observedAt: string;
  jetstream: AdmissionPipelineSnapshot | null;
  clickhouseAvailable: boolean;
  codes: PipelineStatusCode[];
}

export interface PipelineStatusPorts {
  readAdmissionSnapshot(): Promise<AdmissionPipelineSnapshot>;
  checkClickHouse(): Promise<void>;
}

export async function inspectPipelineStatus(
  ports: PipelineStatusPorts,
  thresholds: PipelineStatusThresholds = DEFAULT_PIPELINE_STATUS_THRESHOLDS,
  now: number = Date.now(),
): Promise<PipelineStatus> {
  const [admission, clickhouse] = await Promise.allSettled([
    ports.readAdmissionSnapshot(),
    ports.checkClickHouse(),
  ]);
  const snapshot = admission.status === 'fulfilled' ? admission.value : null;
  const clickhouseAvailable = clickhouse.status === 'fulfilled';
  const codes: PipelineStatusCode[] = [];

  if (snapshot === null) codes.push('nats_unavailable');
  if (!clickhouseAvailable) codes.push('clickhouse_unavailable');
  if (snapshot !== null) {
    if (snapshot.lostBytes > 0) codes.push('stream_data_lost');
    if (snapshot.streamMaxBytes > 0 && snapshot.streamBytes / snapshot.streamMaxBytes >= 0.9) {
      codes.push('stream_near_capacity');
    }
    if (snapshot.streamStoredMessages > thresholds.maxStoredMessages) {
      codes.push('stored_message_limit_exceeded');
    }
    if (snapshot.consumerRedelivered > thresholds.maxRedelivered) {
      codes.push('redelivery_limit_exceeded');
    }
    if (snapshot.oldestStoredMessageAt !== null) {
      const oldest = Date.parse(snapshot.oldestStoredMessageAt);
      if (!Number.isFinite(oldest)) {
        codes.push('invalid_oldest_message_timestamp');
      } else if (now - oldest > thresholds.maxOldestMessageAgeMs) {
        codes.push('oldest_message_age_exceeded');
      }
    }
  }

  return {
    status:
      snapshot === null || !clickhouseAvailable
        ? 'unavailable'
        : codes.length > 0
          ? 'degraded'
          : 'ok',
    observedAt: new Date(now).toISOString(),
    jetstream: snapshot,
    clickhouseAvailable,
    codes,
  };
}
