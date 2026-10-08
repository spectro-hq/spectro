import {
  ENVELOPE_VERSION,
  EVENT_VERSION,
  type Envelope,
  type EventContext,
  type EventType,
  type SpectroEvent,
} from '@spectro/protocol';
import type { SchemaContractId } from './schema-catalogue.js';

const context: EventContext = {
  sdk: { name: 'spectro.browser', version: '0.1.0' },
  project: { id: 'prj_example' },
  environment: 'development',
  session: { id: 'ses_example', startedAt: 1_790_812_800_000 },
  page: { id: 'page_example', url: 'https://app.example/checkout', path: '/checkout' },
};
const common = { version: EVENT_VERSION, timestamp: 1_790_812_801_000, context };

/** Synthetic reference data, independent of customer projects and captured events. */
export const schemaExampleEvents = {
  session: {
    ...common,
    id: '01994f36-0184-7450-a24f-7bbed1879601',
    type: 'session',
    name: 'session_start',
    payload: { action: 'start' },
  },
  page: {
    ...common,
    id: '01994f36-0184-7450-a24f-7bbed1879602',
    type: 'page',
    name: 'page_view',
    payload: { action: 'view' },
  },
  error: {
    ...common,
    id: '01994f36-0184-7450-a24f-7bbed1879603',
    type: 'error',
    name: 'runtime_error',
    payload: {
      mechanism: 'runtime',
      name: 'TypeError',
      message: 'Example application error',
      handled: false,
      stack: [
        {
          filename: 'https://app.example/assets/app.js',
          function: 'submitOrder',
          line: 42,
          column: 8,
          inApp: true,
        },
      ],
      source: { url: 'https://app.example/assets/app.js', line: 42, column: 8 },
    },
  },
  performance: {
    ...common,
    id: '01994f36-0184-7450-a24f-7bbed1879604',
    type: 'performance',
    name: 'web_vital',
    payload: { metric: 'lcp', value: 1850, unit: 'ms', rating: 'good' },
  },
  network: {
    ...common,
    id: '01994f36-0184-7450-a24f-7bbed1879605',
    type: 'network',
    name: 'fetch_request',
    payload: {
      request: { method: 'POST', url: 'https://api.example/orders' },
      response: { status: 503 },
      timing: { start: 1250, duration: 180 },
      initiator: 'fetch',
      success: false,
    },
  },
  interaction: {
    ...common,
    id: '01994f36-0184-7450-a24f-7bbed1879606',
    type: 'interaction',
    name: 'element_click',
    payload: { target: { tag: 'button', role: 'button' } },
  },
  custom: {
    ...common,
    id: '01994f36-0184-7450-a24f-7bbed1879607',
    type: 'custom',
    name: 'checkout_step',
    payload: { properties: { step: 'review', itemCount: 2 } },
  },
} satisfies Record<EventType, SpectroEvent>;

export const schemaExampleEnvelope: Envelope = {
  version: ENVELOPE_VERSION,
  sentAt: 1_790_812_802_000,
  items: [{ type: 'event', payload: schemaExampleEvents.error }],
};

export function schemaExample(contract: SchemaContractId): unknown {
  if (contract === 'envelope') return schemaExampleEnvelope;
  if (contract === 'event') return schemaExampleEvents.error;
  if (contract === 'context') return context;
  return schemaExampleEvents[contract].payload;
}

export function schemaGuidance(contract: SchemaContractId): string {
  switch (contract) {
    case 'envelope':
      return 'API keys belong in transport headers, never in the envelope or its events.';
    case 'event':
      return 'timestamp is Unix epoch milliseconds. Event type selects its payload contract; each allOf rule applies conditionally.';
    case 'context':
      return 'SDK, project and environment are required. Optional context and user traits are not a license to collect personal data.';
    case 'error':
      return 'Final error normalization and fingerprinting happen server-side. Stack ordering is not specified by this contract.';
    case 'network':
      return 'The browser SDK sanitizes request URLs. Authorization, cookies and request/response bodies are not collected by default.';
    case 'interaction':
      return 'The contract permits optional target metadata and coordinates; browser capture does not collect input values by default.';
    case 'custom':
      return 'Custom properties must remain privacy-safe and bounded. Recursive JSON has runtime depth limits beyond this schema.';
    case 'performance':
      return 'A missing rating is not inferred. Attribution is bounded JSON, with runtime depth limits beyond this schema.';
    case 'page':
      return 'A route transition creates a new page lifecycle. Keep paths and URLs free of sensitive values.';
    case 'session':
      return 'Session context is first-class; the payload describes the lifecycle action rather than user identity.';
  }
}
