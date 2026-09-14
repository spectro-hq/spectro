import { describe, expect, it, vi } from 'vitest';

import { EVENT_VERSION, type SpectroEvent } from '@spectro/protocol';

import {
  CLICKHOUSE_EVENTS_TABLE,
  ClickHouseProcessedEventWriter,
  toClickHouseEventRow,
  type ClickHouseInsertClient,
} from './clickhouse.js';
import type { ProcessedEvent } from './processor.js';

const event: SpectroEvent<'custom'> = {
  id: '01994f36-017a-78db-82af-8d463d754f1e',
  type: 'custom',
  name: 'checkout_started',
  version: EVENT_VERSION,
  timestamp: 1_789_368_123_456,
  context: {
    sdk: { name: '@spectro/browser', version: '0.1.0' },
    project: { id: 'prj_checkout' },
    environment: 'production',
    session: { id: 'ses_01' },
    user: { id: 'usr_01', anonymousId: 'anon_01' },
    page: { id: 'page_01', url: 'https://shop.example/checkout', path: '/checkout' },
    release: { version: '1.8.2' },
    trace: { traceId: 'trace_01' },
    tags: { region: 'cn-east' },
  },
  payload: { properties: { amount: 399, currency: 'CNY' } },
};

const processed: ProcessedEvent = {
  event,
  processing: {
    version: 1,
    envelopeSentAt: 1_789_368_124_000,
    processedAt: 1_789_368_130_000,
  },
};

describe('ClickHouseProcessedEventWriter', () => {
  it('projects common query dimensions and preserves bounded protocol JSON', () => {
    expect(toClickHouseEventRow(processed)).toMatchObject({
      event_id: event.id,
      event_type: 'custom',
      event_name: 'checkout_started',
      timestamp_ms: '1789368123456',
      envelope_sent_at_ms: '1789368124000',
      processed_at_ms: '1789368130000',
      project_id: 'prj_checkout',
      environment: 'production',
      session_id: 'ses_01',
      user_id: 'usr_01',
      anonymous_id: 'anon_01',
      page_path: '/checkout',
      release_version: '1.8.2',
      trace_id: 'trace_01',
      tags: { region: 'cn-east' },
      error_fingerprint: '',
      context_json: JSON.stringify(event.context),
      payload_json: JSON.stringify(event.payload),
    });
  });

  it('waits for an acknowledged asynchronous insert of the complete batch', async () => {
    const insert = vi
      .fn<ClickHouseInsertClient['insert']>()
      .mockResolvedValue({ query_id: 'query_01' });
    const writer = new ClickHouseProcessedEventWriter({ insert });

    await expect(writer.append([processed])).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledWith({
      table: CLICKHOUSE_EVENTS_TABLE,
      values: [toClickHouseEventRow(processed)],
      format: 'JSONEachRow',
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  });

  it('does not create an empty ClickHouse insert', async () => {
    const insert = vi.fn<ClickHouseInsertClient['insert']>();
    const writer = new ClickHouseProcessedEventWriter({ insert });

    await writer.append([]);
    expect(insert).not.toHaveBeenCalled();
  });
});
