import type { EventType } from '@spectro/protocol';

import type { EventListItem, EventListPage } from './event-query.js';

const sampleEvents = [
  {
    id: '01994f36-0188-7450-a24f-7bbed18796a1',
    type: 'error',
    name: 'runtime_error',
    offset: 12_000,
  },
  {
    id: '01994f36-0187-7b85-899b-fc860c547575',
    type: 'network',
    name: 'fetch_request',
    offset: 28_000,
  },
  {
    id: '01994f36-0186-78db-82af-8d463d754f1e',
    type: 'interaction',
    name: 'element_click',
    offset: 45_000,
  },
  {
    id: '01994f36-0185-7215-9a0a-bb7f26797324',
    type: 'performance',
    name: 'web_vital_lcp',
    offset: 73_000,
  },
  { id: '01994f36-0184-7cca-a6d0-d7331647b161', type: 'page', name: 'page_view', offset: 104_000 },
  {
    id: '01994f36-0183-7b56-8b12-e9675c1a6c84',
    type: 'custom',
    name: 'checkout_completed',
    offset: 137_000,
  },
  {
    id: '01994f36-0182-7776-845e-92122d2fe0a9',
    type: 'network',
    name: 'xhr_request',
    offset: 181_000,
  },
  {
    id: '01994f36-0181-70d7-818a-e6f675c521b9',
    type: 'interaction',
    name: 'form_submit',
    offset: 236_000,
  },
  {
    id: '01994f36-0180-78f5-8801-04c8879ea7db',
    type: 'performance',
    name: 'long_task',
    offset: 312_000,
  },
] as const satisfies ReadonlyArray<{
  id: string;
  type: EventType;
  name: string;
  offset: number;
}>;

function payloadFor(type: EventType): Record<string, unknown> {
  switch (type) {
    case 'error':
      return {
        mechanism: 'runtime',
        name: 'TypeError',
        message: "Cannot read properties of undefined (reading 'id')",
        handled: false,
        source: { url: 'https://shop.example/checkout', line: 412, column: 21 },
      };
    case 'performance':
      return { metric: 'lcp', value: 2_184, unit: 'ms', rating: 'needs_improvement' };
    case 'network':
      return {
        request: { method: 'POST', url: 'https://shop.example/api/payments' },
        response: { status: 200 },
        timing: { start: 324.8, duration: 418.2 },
        initiator: 'fetch',
        success: true,
      };
    case 'interaction':
      return { target: { tag: 'button', role: 'button', monitorId: 'submit-order' } };
    case 'page':
      return { action: 'view', to: '/checkout' };
    case 'custom':
      return { properties: { currency: 'USD', order_state: 'confirmed' } };
    case 'session':
      return { action: 'start' };
  }
}

export function createIllustrativePage(
  now = Date.now(),
  projectId = 'prj_checkout',
  environment = 'production',
): EventListPage {
  const data: EventListItem[] = sampleEvents.map((sample, index) => {
    const timestamp = now - sample.offset;
    return {
      event: {
        id: sample.id,
        type: sample.type,
        name: sample.name,
        version: 1,
        timestamp,
        context: {
          sdk: { name: '@spectro/browser', version: '0.1.0' },
          project: { id: projectId },
          environment,
          session: { id: index < 6 ? 'ses_8f3e2c' : 'ses_1a9d4b', startedAt: now - 480_000 },
          user: { id: 'usr_anon_42', anonymousId: 'anon_7b3d19' },
          page: {
            id: index < 6 ? 'page_checkout' : 'page_cart',
            url: index < 6 ? 'https://shop.example/checkout' : 'https://shop.example/cart',
            path: index < 6 ? '/checkout' : '/cart',
            title: index < 6 ? 'Checkout' : 'Cart',
          },
          release: { version: 'web@1.4.2' },
          trace: { traceId: 'tr_d91e4f2a', spanId: 'sp_7b3c9d1e' },
          tags: { region: 'us-west', surface: 'checkout' },
        },
        payload: payloadFor(sample.type),
      },
      processing: {
        version: 1,
        envelopeSentAt: timestamp + 180,
        processedAt: timestamp + 420,
        ...(sample.type === 'error' ? { errorFingerprint: 'err_6f87a1e0c93a4b15' } : {}),
      },
    };
  });

  return { data };
}
