import { describe, expect, it } from 'vitest';

import { summarizeAdmissionFailureAdvisory, summarizeAdmissionPipeline } from './operations.js';

describe('admission pipeline operations', () => {
  it('reports stored, pending, and redelivered counts without inferring exhausted deliveries', () => {
    const snapshot = summarizeAdmissionPipeline(
      {
        state: {
          messages: 8,
          bytes: 1_024,
          first_ts: '2026-09-25T06:00:00Z',
          lost: { bytes: 0 },
        },
        config: { max_bytes: 10_000 },
      },
      {
        num_pending: 5,
        num_ack_pending: 2,
        num_redelivered: 1,
        config: { max_deliver: 10 },
        delivered: { stream_seq: 14 },
        ack_floor: { stream_seq: 12 },
      },
    );

    expect(snapshot).toEqual({
      streamStoredMessages: 8,
      streamBytes: 1_024,
      streamMaxBytes: 10_000,
      oldestStoredMessageAt: '2026-09-25T06:00:00Z',
      lostBytes: 0,
      consumerPending: 5,
      consumerAckPending: 2,
      consumerRedelivered: 1,
      consumerMaxDeliver: 10,
      consumerDeliveredSequence: 14,
      consumerAcknowledgedSequence: 12,
    });
    expect(
      summarizeAdmissionPipeline(
        {
          state: { messages: 0, bytes: 0, first_ts: '' },
          config: { max_bytes: 10_000 },
        },
        {
          num_pending: 0,
          num_ack_pending: 0,
          num_redelivered: 0,
          config: {},
          delivered: { stream_seq: 14 },
          ack_floor: { stream_seq: 14 },
        },
      ),
    ).toMatchObject({ oldestStoredMessageAt: null, consumerMaxDeliver: null });
  });

  it('accepts only failure advisories for the Spectro stream and consumer', () => {
    expect(
      summarizeAdmissionFailureAdvisory({
        kind: 'max_deliver',
        data: {
          stream: 'SPECTRO_ADMITTED',
          consumer: 'spectro-processor-v1',
          stream_seq: 42,
          payload: { password: 'do-not-log' },
        },
      }),
    ).toEqual({
      kind: 'max_deliver',
      stream: 'SPECTRO_ADMITTED',
      consumer: 'spectro-processor-v1',
      streamSequence: 42,
    });
    expect(
      summarizeAdmissionFailureAdvisory({
        kind: 'terminated',
        data: { stream: 'SPECTRO_ADMITTED', consumer: 'spectro-processor-v1', stream_seq: 43 },
      }),
    ).toMatchObject({ kind: 'terminated', streamSequence: 43 });
    expect(
      summarizeAdmissionFailureAdvisory({
        kind: 'max_deliver',
        data: { stream: 'OTHER', consumer: 'spectro-processor-v1', stream_seq: 42 },
      }),
    ).toBeUndefined();
    expect(
      summarizeAdmissionFailureAdvisory({
        kind: 'max_deliver',
        data: { stream: 'SPECTRO_ADMITTED', consumer: 'spectro-processor-v1', stream_seq: '42' },
      }),
    ).toBeUndefined();
  });
});
