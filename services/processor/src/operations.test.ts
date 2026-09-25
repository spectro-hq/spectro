import { describe, expect, it, vi } from 'vitest';

import type { AdmissionPipelineSnapshot } from '@spectro/pipeline';

import {
  inspectPipelineStatus,
  pipelineStatusThresholdsFrom,
  type PipelineStatusPorts,
} from './operations.js';

const emptySnapshot: AdmissionPipelineSnapshot = {
  streamStoredMessages: 0,
  streamBytes: 0,
  streamMaxBytes: 1_000,
  oldestStoredMessageAt: null,
  lostBytes: 0,
  consumerPending: 0,
  consumerAckPending: 0,
  consumerRedelivered: 0,
  consumerMaxDeliver: 10,
  consumerDeliveredSequence: 0,
  consumerAcknowledgedSequence: 0,
};
const now = Date.parse('2026-09-25T06:10:00Z');

function ports(snapshot: AdmissionPipelineSnapshot = emptySnapshot): PipelineStatusPorts {
  return {
    readAdmissionSnapshot: vi
      .fn<PipelineStatusPorts['readAdmissionSnapshot']>()
      .mockResolvedValue(snapshot),
    checkClickHouse: vi.fn<PipelineStatusPorts['checkClickHouse']>().mockResolvedValue(undefined),
  };
}

describe('pipeline status', () => {
  it('validates configurable warning thresholds', () => {
    expect(pipelineStatusThresholdsFrom({})).toEqual({
      maxStoredMessages: 1_000,
      maxOldestMessageAgeMs: 300_000,
      maxRedelivered: 10,
    });
    expect(
      pipelineStatusThresholdsFrom({
        SPECTRO_OPS_MAX_STORED_MESSAGES: '0',
        SPECTRO_OPS_MAX_OLDEST_MESSAGE_AGE_MS: '90000',
        SPECTRO_OPS_MAX_REDELIVERED: '2',
      }),
    ).toEqual({ maxStoredMessages: 0, maxOldestMessageAgeMs: 90_000, maxRedelivered: 2 });
    expect(() => pipelineStatusThresholdsFrom({ SPECTRO_OPS_MAX_STORED_MESSAGES: '' })).toThrow(
      'SPECTRO_OPS_MAX_STORED_MESSAGES must be a non-negative safe integer.',
    );
    expect(() => pipelineStatusThresholdsFrom({ SPECTRO_OPS_MAX_REDELIVERED: '-1' })).toThrow(
      'SPECTRO_OPS_MAX_REDELIVERED must be a non-negative safe integer.',
    );
  });

  it('reports a healthy empty queue and reachable event plane', async () => {
    await expect(inspectPipelineStatus(ports(), undefined, now)).resolves.toEqual({
      status: 'ok',
      observedAt: '2026-09-25T06:10:00.000Z',
      jetstream: emptySnapshot,
      clickhouseAvailable: true,
      codes: [],
    });
  });

  it('reports delayed, repeated, and nearly full admission separately', async () => {
    const snapshot: AdmissionPipelineSnapshot = {
      ...emptySnapshot,
      streamStoredMessages: 101,
      streamBytes: 950,
      oldestStoredMessageAt: '2026-09-25T06:00:00Z',
      consumerRedelivered: 11,
    };
    const result = await inspectPipelineStatus(
      ports(snapshot),
      { maxStoredMessages: 100, maxOldestMessageAgeMs: 300_000, maxRedelivered: 10 },
      now,
    );
    expect(result.status).toBe('degraded');
    expect(result.codes).toEqual([
      'stream_near_capacity',
      'stored_message_limit_exceeded',
      'redelivery_limit_exceeded',
      'oldest_message_age_exceeded',
    ]);
  });

  it('surfaces lost stream bytes even with an otherwise empty queue', async () => {
    const result = await inspectPipelineStatus(
      ports({ ...emptySnapshot, lostBytes: 1 }),
      undefined,
      now,
    );
    expect(result).toMatchObject({ status: 'degraded', codes: ['stream_data_lost'] });
  });

  it('reports NATS and ClickHouse outages without exposing exception messages', async () => {
    const result = await inspectPipelineStatus(
      {
        readAdmissionSnapshot: async () => {
          throw new Error('nats://user:password@localhost');
        },
        checkClickHouse: async () => {
          throw new Error('ClickHouse password');
        },
      },
      undefined,
      now,
    );
    expect(result).toEqual({
      status: 'unavailable',
      observedAt: '2026-09-25T06:10:00.000Z',
      jetstream: null,
      clickhouseAvailable: false,
      codes: ['nats_unavailable', 'clickhouse_unavailable'],
    });
    expect(JSON.stringify(result)).not.toContain('password');
  });
});
