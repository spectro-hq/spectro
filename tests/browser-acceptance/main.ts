import { destroy, flush, IndexedDbEventOutbox, init } from '@spectro/browser';
import { validateEnvelope } from '@spectro/protocol';

import { hostedConsoleUrl, ingestionFailureMessage, parseHostedConnection } from './connection.js';

const params = new URLSearchParams(location.search);
const requestedMode = params.get('mode');
const mode =
  requestedMode === 'hosted' ? 'hosted' : requestedMode === 'ack-loss' ? 'ack-loss' : 'live';
let projectId = 'prj_browser_acceptance';
let environment = 'acceptance';
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
const sessionElement = sessionLabel;
modeLabel.textContent = mode;

const outbox = new IndexedDbEventOutbox();
let admittedErrorId: string | undefined;
let lostAcknowledgement = false;
let acceptedRequests = 0;
let acceptedEvents = 0;
let lastHttpStatus: number | undefined;
let failureMessage: string | undefined;
let activeClient: ReturnType<typeof init>;
const signalControls = document.querySelector<HTMLFieldSetElement>('#signal-controls');
const connectionForm = document.querySelector<HTMLFormElement>('#connection');
const projectInput = document.querySelector<HTMLInputElement>('#project');
const environmentInput = document.querySelector<HTMLInputElement>('#environment');
const keyInput = document.querySelector<HTMLInputElement>('#browser-key');
const connectionError = document.querySelector<HTMLParagraphElement>('#connection-error');
const consoleLink = document.querySelector<HTMLAnchorElement>('#console-link');

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
  let response: Response;
  try {
    // The ingestion boundary must never receive a Console cookie.
    response = await nativeFetch(input, { ...requestInit, credentials: 'omit' });
  } catch {
    failureMessage = 'Cannot reach ingestion. Check the local service and proxy, then retry.';
    throw new TypeError('Ingestion is unreachable');
  }
  lastHttpStatus = response.status;
  if (response.ok) {
    acceptedRequests += 1;
    if (envelope.success) acceptedEvents += envelope.data.items.length;
    failureMessage = undefined;
  } else {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined);
    const code =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'object' &&
      body.error !== null &&
      'code' in body.error &&
      typeof body.error.code === 'string'
        ? body.error.code
        : undefined;
    failureMessage = ingestionFailureMessage(response.status, code);
  }
  if (mode === 'ack-loss' && errorEvent !== undefined && envelope.success && response.ok) {
    admittedErrorId = errorEvent.id;
    sessionStorage.setItem(storageKey, errorEvent.id);
    sessionStorage.setItem(firstSentAtKey, String(envelope.data.sentAt));
    lostAcknowledgement = true;
    throw new TypeError('Simulated lost acknowledgement after ingestion accepted the error');
  }
  return response;
};

function connectBrowser(apiKey: string): void {
  destroy();
  activeClient = init({
    projectId,
    environment,
    endpoint: `${location.origin}/ingest`,
    apiKey,
    fetch: fetcher,
    performance: {
      captureWebVitals: false,
      captureLongTasks: false,
      captureNavigationTiming: true,
    },
    onError: () => {
      void showStatus('SDK reported a delivery or storage failure');
    },
  });
  if (activeClient === undefined)
    throw new Error('Browser SDK could not start. Check the connection and retry.');
  acceptedRequests = 0;
  acceptedEvents = 0;
  lastHttpStatus = undefined;
  failureMessage = undefined;
  sessionElement.textContent = activeClient.getContext().session?.id ?? 'unknown';
  if (signalControls !== null) signalControls.disabled = mode === 'hosted';
}

if (mode === 'hosted') {
  if (
    connectionForm === null ||
    projectInput === null ||
    environmentInput === null ||
    keyInput === null ||
    connectionError === null ||
    consoleLink === null
  ) {
    throw new Error('Hosted acceptance controls are missing');
  }
  connectionForm.hidden = false;
  projectInput.value = params.get('project') ?? '';
  environmentInput.value = params.get('environment') ?? 'development';
  document.querySelector<HTMLButtonElement>('#reload')?.setAttribute('hidden', '');
  connectionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    connectionError.textContent = '';
    const button = connectionForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button !== null) {
      button.disabled = true;
      button.textContent = 'Connecting…';
    }
    try {
      const connection = parseHostedConnection({
        projectId: projectInput.value,
        environment: environmentInput.value,
        apiKey: keyInput.value,
      });
      projectId = connection.projectId;
      environment = connection.environment;
      connectBrowser(connection.apiKey);
      keyInput.value = '';
      await flush();
      if (lastHttpStatus !== 202) {
        destroy();
        activeClient = undefined;
        sessionElement.textContent = 'not connected';
        consoleLink.hidden = true;
        connectionError.textContent =
          failureMessage ?? 'Could not verify ingestion. Check local services and reconnect.';
        await showStatus('connection was not accepted');
        return;
      }
      if (signalControls !== null) signalControls.disabled = false;
      consoleLink.href = hostedConsoleUrl(connection);
      consoleLink.hidden = false;
      await showStatus('connected; initial lifecycle signals flushed');
    } catch (error) {
      connectionError.textContent =
        error instanceof Error ? error.message : 'Could not connect. Check the fields and retry.';
    } finally {
      if (button !== null) {
        button.disabled = false;
        button.textContent = activeClient === undefined ? 'Connect SDK' : 'Reconnect SDK';
      }
    }
  });
} else {
  connectBrowser('sp_local_dev');
}

async function showStatus(lastAction: string): Promise<void> {
  const persisted = await outbox.load({ projectId, environment }).catch(() => undefined);
  statusElement.textContent = JSON.stringify(
    {
      mode,
      lastAction,
      projectId: activeClient === undefined ? undefined : projectId,
      environment: activeClient === undefined ? undefined : environment,
      sessionId: activeClient?.getContext().session?.id,
      pageId: activeClient?.getContext().page?.id,
      errorId: admittedErrorId ?? sessionStorage.getItem(storageKey),
      runId,
      firstSentAt: Number(sessionStorage.getItem(firstSentAtKey)),
      replaySentAt: Number(sessionStorage.getItem(replaySentAtKey)),
      lostAcknowledgement,
      acceptedRequests,
      acceptedEvents,
      lastHttpStatus,
      failure: failureMessage,
      persistedUrgentEvents: persisted?.length ?? 'unavailable',
    },
    null,
    2,
  );
}

function captureRuntimeError(): void {
  const errorMessage = `Spectro browser acceptance runtime error ${runId}`;
  window.dispatchEvent(
    new ErrorEvent('error', {
      message: errorMessage,
      error: new Error(errorMessage),
    }),
  );
}

async function runAction(action: () => Promise<unknown>, lastAction: string): Promise<void> {
  if (activeClient === undefined) return;
  if (signalControls !== null) signalControls.disabled = true;
  try {
    // The delegated document listener must capture the click before flushing.
    await Promise.resolve();
    await action();
  } catch {
    failureMessage = 'The test request could not complete. Check local services and retry.';
  } finally {
    if (signalControls !== null) signalControls.disabled = false;
    await showStatus(lastAction);
  }
}

document.querySelector<HTMLButtonElement>('#capture-error')?.addEventListener('click', () => {
  void runAction(async () => {
    captureRuntimeError();
    await flush({ priority: 'immediate' });
  }, 'runtime error captured');
});

document.querySelector<HTMLButtonElement>('#capture-network')?.addEventListener('click', () => {
  void runAction(async () => {
    await fetch('/network-failure');
    await flush({ priority: 'immediate' });
  }, 'HTTP 503 captured');
});

document.querySelector<HTMLButtonElement>('#capture-interaction')?.addEventListener('click', () => {
  void runAction(() => flush(), 'monitored click captured');
});

document.querySelector<HTMLButtonElement>('#flush')?.addEventListener('click', () => {
  void runAction(() => flush(), 'all signals flushed');
});

document.querySelector<HTMLButtonElement>('#capture-all')?.addEventListener('click', () => {
  void runAction(async () => {
    captureRuntimeError();
    await fetch('/network-failure');
    await flush();
  }, 'test signals captured; check the delivery result below');
});

document.querySelector<HTMLButtonElement>('#reload')?.addEventListener('click', () => {
  location.search = '?mode=live';
});

window.setTimeout(
  () =>
    void showStatus(
      mode === 'hosted' && activeClient === undefined
        ? 'waiting for a Browser Key'
        : 'startup and automatic restore',
    ),
  1_000,
);
window.addEventListener('pagehide', () => destroy(), { once: true });
