import { afterEach, describe, expect, it, vi } from 'vitest';

import { destroy, flush, init } from '../src/index.js';

afterEach(() => {
  destroy();
  vi.unstubAllGlobals();
});

function originalPushState(): void {}

function originalReplaceState(): void {}

function documentHarness() {
  const events = new EventTarget();
  return {
    browserDocument: {
      title: 'Checkout',
      referrer: '',
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        events.addEventListener(type, listener);
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        events.removeEventListener(type, listener);
      },
    },
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
  };
}

describe('browser interaction public API', () => {
  it('captures a marked click with active session and page context', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ accepted: 3 }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const storage = new Map<string, string>();
    const location = { href: 'https://app.example/checkout?cart=private' };
    const history = { pushState: originalPushState, replaceState: originalReplaceState };
    const windowEvents = new EventTarget();
    vi.stubGlobal('window', {
      location,
      history,
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    });
    const documentEvents = documentHarness();
    vi.stubGlobal('document', documentEvents.browserDocument);
    const initialized = init({
      projectId: 'prj_test',
      environment: 'test',
      endpoint: 'https://ingest.example',
      apiKey: 'sp_test',
      fetch: fetchMock,
      errors: false,
      network: false,
      performance: false,
    });
    expect(initialized).toBeDefined();

    const monitoredButton = {
      tagName: 'BUTTON',
      getAttribute(name: string) {
        if (name === 'data-spectro-monitor-id') return 'submit_order';
        if (name === 'role') return 'button';
        return null;
      },
      get textContent(): never {
        throw new Error('Private button text must not be read');
      },
    };
    const click = new Event('click');
    Object.defineProperty(click, 'composedPath', { value: () => [monitoredButton] });
    documentEvents.dispatchEvent(click);
    await expect(flush()).resolves.toEqual({ sent: 3, remaining: 0 });

    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    const envelope: unknown = JSON.parse(typeof body === 'string' ? body : '{}');
    expect(envelope).toMatchObject({
      items: [
        { payload: { type: 'session', name: 'session_start' } },
        { payload: { type: 'page', name: 'page_view' } },
        {
          payload: {
            type: 'interaction',
            name: 'element_click',
            context: {
              session: { id: expect.stringMatching(/^ses_/u) },
              page: {
                id: expect.stringMatching(/^page_/u),
                url: 'https://app.example/checkout',
                path: '/checkout',
              },
            },
            payload: {
              target: { monitorId: 'submit_order', tag: 'button', role: 'button' },
            },
          },
        },
      ],
    });
    expect(JSON.stringify(envelope)).not.toContain('cart=private');

    initialized?.destroy();
    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);
  });
});
