export type BrowserErrorObservation =
  | {
      mechanism: 'runtime';
      value: unknown;
      message?: string;
      source?: { url?: string; line?: number; column?: number };
    }
  | { mechanism: 'promise'; value: unknown }
  | { mechanism: 'resource'; url?: string; tagName?: string };

export interface BrowserErrorRuntime {
  subscribe(listener: (observation: BrowserErrorObservation) => void): () => void;
}

function readProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function readString(value: object, key: string): string | undefined {
  const candidate = readProperty(value, key);
  return typeof candidate === 'string' ? candidate : undefined;
}

function readNumber(value: object, key: string): number | undefined {
  const candidate = readProperty(value, key);
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0
    ? candidate
    : undefined;
}

function hasProperty(value: object, key: string): boolean {
  try {
    return Reflect.has(value, key);
  } catch {
    return false;
  }
}

function runtimeObservation(event: Event): BrowserErrorObservation | undefined {
  if (!hasProperty(event, 'message')) return undefined;
  const message = readString(event, 'message');
  const filename = readString(event, 'filename');
  const line = readNumber(event, 'lineno');
  const column = readNumber(event, 'colno');
  return {
    mechanism: 'runtime',
    value: readProperty(event, 'error'),
    ...(message === undefined ? {} : { message }),
    ...(filename === undefined && line === undefined && column === undefined
      ? {}
      : {
          source: {
            ...(filename === undefined ? {} : { url: filename }),
            ...(line === undefined ? {} : { line }),
            ...(column === undefined ? {} : { column }),
          },
        }),
  };
}

function resourceObservation(event: Event): BrowserErrorObservation {
  const target = event.target;
  if (typeof target !== 'object' || target === null) return { mechanism: 'resource' };
  const tagName = readString(target, 'tagName')?.toLowerCase();
  const candidates = ['currentSrc', 'src', 'href'];
  let url: string | undefined;
  for (const key of candidates) {
    const candidate = readString(target, key);
    if (candidate) {
      url = candidate;
      break;
    }
  }
  return {
    mechanism: 'resource',
    ...(url === undefined ? {} : { url }),
    ...(tagName === undefined ? {} : { tagName }),
  };
}

export function createBrowserErrorRuntime(): BrowserErrorRuntime | undefined {
  if (typeof window === 'undefined') return undefined;

  return {
    subscribe(listener) {
      const errorListener = (event: Event) => {
        listener(runtimeObservation(event) ?? resourceObservation(event));
      };
      const rejectionListener = (event: PromiseRejectionEvent) => {
        listener({ mechanism: 'promise', value: readProperty(event, 'reason') });
      };
      window.addEventListener('error', errorListener, true);
      window.addEventListener('unhandledrejection', rejectionListener);

      return () => {
        window.removeEventListener('error', errorListener, true);
        window.removeEventListener('unhandledrejection', rejectionListener);
      };
    },
  };
}
