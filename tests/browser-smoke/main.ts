import { flush, init } from '../../packages/browser/src/index.js';
import { IndexedDbEventOutbox } from '../../packages/browser/src/outbox.js';

const mode = new URLSearchParams(location.search).get('mode') === 'offline' ? 'offline' : 'online';
const deliveryKey = 'spectro-browser-smoke-last-envelope';
const status = document.querySelector<HTMLPreElement>('#status');
const modeBadge = document.querySelector<HTMLSpanElement>('#mode');

if (status === null || modeBadge === null) throw new Error('Smoke test controls are missing');
modeBadge.textContent = mode;
if (mode === 'offline') localStorage.removeItem(deliveryKey);

function setStatus(value: string): void {
  status.textContent = value;
}

const fetcher: typeof fetch = async (_input, _init) => {
  if (mode === 'offline') throw new TypeError('Simulated offline transport');
  if (typeof _init?.body === 'string') localStorage.setItem(deliveryKey, _init.body);
  return new Response(JSON.stringify({ accepted: 1 }), {
    status: 202,
    headers: { 'content-type': 'application/json' },
  });
};

const client = init({
  projectId: 'prj_browser_smoke',
  environment: 'smoke',
  endpoint: 'https://ingest.invalid',
  apiKey: 'sp_browser_smoke',
  fetch: fetcher,
  lifecycle: false,
  interactions: false,
  network: false,
  performance: false,
});

document.querySelector<HTMLButtonElement>('#capture')?.addEventListener('click', () => {
  const event = new Event('error');
  Object.defineProperties(event, {
    message: { value: 'Smoke test runtime error' },
    error: { value: new Error('Smoke test runtime error') },
  });
  window.dispatchEvent(event);
  setStatus('Unhandled runtime error captured. Click “Flush urgent events” next.');
});

document.querySelector<HTMLButtonElement>('#flush')?.addEventListener('click', async () => {
  const result = await flush({ priority: 'immediate' });
  const stored = await new IndexedDbEventOutbox().load({
    projectId: 'prj_browser_smoke',
    environment: 'smoke',
  });
  setStatus(
    JSON.stringify(
      {
        mode,
        result,
        persistedUrgentEvents: stored.length,
        lastRequest:
          mode === 'online' ? 'accepted by smoke transport' : 'simulated offline failure',
      },
      null,
      2,
    ),
  );
});

document.querySelector<HTMLButtonElement>('#reload-online')?.addEventListener('click', () => {
  location.search = '?mode=online';
});

if (mode === 'online') {
  window.setTimeout(async () => {
    const stored = await new IndexedDbEventOutbox().load({
      projectId: 'prj_browser_smoke',
      environment: 'smoke',
    });
    setStatus(
      JSON.stringify(
        {
          mode,
          persistedAfterStartupRetry: stored.length,
          automaticallyRetriedEnvelope: localStorage.getItem(deliveryKey),
        },
        null,
        2,
      ),
    );
  }, 150);
}

window.addEventListener('pagehide', () => client?.destroy(), { once: true });
