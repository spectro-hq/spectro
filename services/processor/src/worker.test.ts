import { describe, expect, it, vi } from 'vitest';

import { ENVELOPE_VERSION, EVENT_VERSION, type Envelope } from '@spectro/protocol';
import {
  createAdmissionMetadata,
  type AdmissionDelivery,
  type AdmissionSource,
} from '@spectro/pipeline';

import { EventProcessor, type ProcessedEventWriter } from './processor.js';
import { ProcessorWorker, type ProcessorRetryNotice } from './worker.js';

const envelope: Envelope = {
  version: ENVELOPE_VERSION,
  sentAt: 1_789_368_123_456,
  items: [
    {
      type: 'event',
      payload: {
        id: '01994f36-017a-78db-82af-8d463d754f1e',
        type: 'custom',
        name: 'checkout_started',
        version: EVENT_VERSION,
        timestamp: 1_789_368_123_456,
        context: {
          sdk: { name: '@spectro/browser', version: '0.1.0' },
          project: { id: 'prj_checkout' },
          environment: 'production',
        },
        payload: { properties: { amount: 399 } },
      },
    },
  ],
};

function delivery(overrides: Partial<AdmissionDelivery> = {}): AdmissionDelivery {
  return {
    admitted: { ...createAdmissionMetadata(envelope, 1_789_368_124_000), envelope },
    acknowledge: vi.fn<AdmissionDelivery['acknowledge']>(),
    retry: vi.fn<AdmissionDelivery['retry']>(),
    terminate: vi.fn<AdmissionDelivery['terminate']>(),
    ...overrides,
  };
}

describe('ProcessorWorker', () => {
  it('acknowledges only after the durable writer succeeds', async () => {
    const item = delivery();
    const append = vi.fn<ProcessedEventWriter['append']>().mockResolvedValue(undefined);
    const source: AdmissionSource = {
      next: vi.fn<AdmissionSource['next']>().mockResolvedValue(item),
    };
    const worker = new ProcessorWorker(source, new EventProcessor({ append }));

    await expect(worker.runOnce()).resolves.toMatchObject({ status: 'processed', processed: 1 });
    expect(append).toHaveBeenCalledOnce();
    expect(item.acknowledge).toHaveBeenCalledOnce();
    expect(item.retry).not.toHaveBeenCalled();
  });

  it('requests delayed redelivery and preserves the processing failure', async () => {
    const item = delivery();
    const failure = new Error('event plane unavailable');
    const writer: ProcessedEventWriter = {
      append: vi.fn<ProcessedEventWriter['append']>().mockRejectedValue(failure),
    };
    const source: AdmissionSource = {
      next: vi.fn<AdmissionSource['next']>().mockResolvedValue(item),
    };
    const onRetry = vi.fn<(notice: ProcessorRetryNotice) => void>();
    const worker = new ProcessorWorker(source, new EventProcessor(writer), 2_500, onRetry);

    await expect(worker.runOnce()).rejects.toBe(failure);
    expect(item.acknowledge).not.toHaveBeenCalled();
    expect(item.retry).toHaveBeenCalledWith(2_500);
    expect(onRetry).toHaveBeenCalledWith({
      envelopeId: item.admitted.envelopeId,
      retryDelayMs: 2_500,
    });
  });

  it('reports an idle poll without acknowledging anything', async () => {
    const source: AdmissionSource = {
      next: vi.fn<AdmissionSource['next']>().mockResolvedValue(undefined),
    };
    const writer: ProcessedEventWriter = { append: vi.fn<ProcessedEventWriter['append']>() };
    const worker = new ProcessorWorker(source, new EventProcessor(writer));

    await expect(worker.runOnce(10)).resolves.toEqual({ status: 'idle' });
  });

  it('keeps the processing failure when the diagnostic hook also fails', async () => {
    const item = delivery();
    const failure = new Error('event plane unavailable');
    const source: AdmissionSource = { next: async () => item };
    const worker = new ProcessorWorker(
      source,
      new EventProcessor({
        append: async () => {
          throw failure;
        },
      }),
      1_000,
      () => {
        throw new Error('logging failed');
      },
    );

    await expect(worker.runOnce()).rejects.toBe(failure);
    expect(item.retry).toHaveBeenCalledWith(1_000);
  });
});
