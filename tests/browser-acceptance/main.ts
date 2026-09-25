import { destroy, flush, IndexedDbEventOutbox, init } from '@spectro/browser';
import { validateEnvelope } from '@spectro/protocol';

const projectId = 'prj_browser_acceptance';
const environment = 'acceptance';
const mode = new URLSearchParams(location.search).get('mode') === 'ack-loss' ? 'ack-loss' : 'live';
const nativeFetch = globalThis.fetch.bind(globalThis);
const storageKey = 'spectro.browser-acceptance.error-id';
const firstSentAtKey = 'spectro.browser-acceptance.first-sent-at';
const replaySentAtKey = 'spectro.browser-acceptance.replay-sent-at';
const runKey = 'spectro.browser-acceptance.run-id';
const runId =
  mode === 'ack-loss'
    ? crypto.randomUUID().replaceAll('-', '')
    : (sessionStorage.getItem(runKey) ?? crypto.randomUUID().replaceAll('-', ''));
sessionStorage.setItem(runKey, runId);
if (mode === 'ack-loss') {
  sessionStorage.removeItem(storageKey);
  sessionStorage.removeItem(firstSentAtKey);
  sessionStorage.removeItem(replaySentAtKey);
}
const status = document.querySelector<HTMLPreElement>('#status');
const modeLabel = document.querySelector<HTMLSpanElement>('#mode');
const sessionLabel = document.querySelector<HTMLSpanElement>('#session');

if (status === null || modeLabel === null || sessionLabel === null) {
  throw new Error('Acceptance controls are missing');
}
const statusElement = status;
modeLabel.textContent = mode;

const outbox = new IndexedDbEventOutbox();
let admittedErrorId: string | undefined;
let lostAcknowledgement = false;
let acceptedRequests = 0;

const fetcher: typeof fetch = async (input, requestInit) => {
  if (mode === 'ack-loss' && lostAcknowledgement) {
    throw new TypeError('Transport unavailable until reload');
  }
  const candidate: unknown =
    typeof requestInit?.body === 'string' ? JSON.parse(requestInit.body) : undefined;
  const envelope = validateEnvelope(candidate);
  const errorEvent = envelope.success
    ? envelope.data.items.find((item) => item.payload.type === 'error')?.payload
    : undefined;
  if (
    mode === 'live' &&
    envelope.success &&
    errorEvent?.id === sessionStorage.getItem(storageKey)
  ) {
    sessionStorage.setItem(replaySentAtKey, String(envelope.data.sentAt));
  }
  const response = await nativeFetch(input, requestInit);
  if (response.ok) acceptedRequests += 1;
  if (mode === 'ack-loss' && errorEvent !== undefined && envelope.success && response.ok) {
    admittedErrorId = errorEvent.id;
    sessionStorage.setItem(storageKey, errorEvent.id);
    sessionStorage.setItem(firstSentAtKey, String(envelope.data.sentAt));
    lostAcknowledgement = true;
    throw new TypeError('Simulated lost acknowledgement after ingestion accepted the error');
  }
  return response;
};

const client = init({
  projectId,
  environment,
  endpoint: `${location.origin}/ingest`,
  apiKey: 'sp_local_dev',
  fetch: fetcher,
  performance: { captureWebVitals: false, captureLongTasks: false, captureNavigationTiming: true },
});
if (client === undefined) throw new Error('Browser SDK failed to initialize');
const activeClient = client;
sessionLabel.textContent = activeClient.getContext().session?.id ?? 'unknown';

async function showStatus(lastAction: string): Promise<void> {
  const persisted = await outbox.load({ projectId, environment });
  statusElement.textContent = JSON.stringify(
    {
      mode,
      lastAction,
      sessionId: activeClient.getContext().session?.id,
      pageId: activeClient.getContext().page?.id,
      errorId: admittedErrorId ?? sessionStorage.getItem(storageKey),
      runId,
      firstSentAt: Number(sessionStorage.getItem(firstSentAtKey)),
      replaySentAt: Number(sessionStorage.getItem(replaySentAtKey)),
      lostAcknowledgement,
      acceptedRequests,
      persistedUrgentEvents: persisted.length,
    },
    null,
    2,
  );
}

document.querySelector<HTMLButtonElement>('#capture-error')?.addEventListener('click', async () => {
  const errorMessage = `Spectro browser acceptance runtime error ${runId}`;
  window.dispatchEvent(
    new ErrorEvent('error', {
      message: errorMessage,
      error: new Error(errorMessage),
    }),
  );
  await flush({ priority: 'immediate' });
  await showStatus('runtime error captured');
});

document
  .querySelector<HTMLButtonElement>('#capture-network')
  ?.addEventListener('click', async () => {
    await fetch('/network-failure');
    await flush({ priority: 'immediate' });
    await showStatus('HTTP 503 captured');
  });

document
  .querySelector<HTMLButtonElement>('#capture-interaction')
  ?.addEventListener('click', async () => {
    await flush();
    await showStatus('monitored click captured');
  });

document.querySelector<HTMLButtonElement>('#flush')?.addEventListener('click', async () => {
  await flush();
  await showStatus('all signals flushed');
});

document.querySelector<HTMLButtonElement>('#reload')?.addEventListener('click', () => {
  location.search = '?mode=live';
});

window.setTimeout(() => void showStatus('startup and automatic restore'), 1_000);
window.addEventListener('pagehide', () => destroy(), { once: true });
