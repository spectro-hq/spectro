import type { CaptureInput } from '@spectro/types';
import type { ErrorPayload, StackFrame } from '@spectro/protocol';

import type { BrowserErrorObservation, BrowserErrorRuntime } from './error-runtime.js';

const MAX_ERROR_NAME_LENGTH = 256;
const MAX_ERROR_MESSAGE_LENGTH = 2_048;
const MAX_FUNCTION_LENGTH = 512;
const MAX_SOURCE_URL_LENGTH = 2_048;
const MAX_FINGERPRINT_ITEMS = 10;
const MAX_FINGERPRINT_ITEM_LENGTH = 256;
const MAX_STACK_FRAMES = 50;
const MAX_STACK_INPUT_LENGTH = 64 * 1_024;

export interface BrowserErrorOptions {
  captureRuntimeErrors?: boolean;
  captureUnhandledRejections?: boolean;
  captureResourceErrors?: boolean;
}

export interface CaptureExceptionOptions {
  handled?: boolean;
  fingerprint?: string[];
}

export interface ErrorCaptureHost {
  activity(): void;
  capture(input: CaptureInput<'error'>): string | undefined;
  report(error: unknown): void;
}

interface NormalizedErrorValue {
  message: string;
  name?: string;
  stack?: StackFrame[];
}

function readProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function boundedText(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}

function primitiveMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return boundedText(value, MAX_ERROR_MESSAGE_LENGTH);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return boundedText(String(value), MAX_ERROR_MESSAGE_LENGTH);
  }
  return undefined;
}

function sanitizeSourceUrl(rawUrl: string): string | undefined {
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('/')) {
    return trimmed.split(/[?#]/u, 1)[0]?.slice(0, MAX_SOURCE_URL_LENGTH);
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.origin}${parsed.pathname}`.slice(0, MAX_SOURCE_URL_LENGTH);
    }
    if (parsed.protocol === 'file:' || parsed.protocol === 'webpack:') {
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.slice(0, MAX_SOURCE_URL_LENGTH);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function parseStackLine(rawLine: string): StackFrame | undefined {
  const line = rawLine.trim();
  const location = /:(\d+):(\d+)\)?$/u.exec(line);
  if (location === null || location.index === undefined) return undefined;
  const lineNumber = Number(location[1]);
  const columnNumber = Number(location[2]);
  if (!Number.isSafeInteger(lineNumber) || !Number.isSafeInteger(columnNumber)) return undefined;

  let head = line.slice(0, location.index).trim();
  if (head.startsWith('at ')) head = head.slice(3).trim();

  let functionName: string | undefined;
  let filename = head;
  const openingParenthesis = head.lastIndexOf('(');
  if (openingParenthesis >= 0) {
    functionName = boundedText(head.slice(0, openingParenthesis), MAX_FUNCTION_LENGTH);
    filename = head.slice(openingParenthesis + 1);
  } else {
    const atSign = head.lastIndexOf('@');
    if (atSign >= 0) {
      functionName = boundedText(head.slice(0, atSign), MAX_FUNCTION_LENGTH);
      filename = head.slice(atSign + 1);
    }
  }

  const safeFilename = sanitizeSourceUrl(filename);
  if (safeFilename === undefined) return undefined;
  return {
    filename: safeFilename,
    ...(functionName ? { function: functionName } : {}),
    line: lineNumber,
    column: columnNumber,
  };
}

export function parseBrowserStack(stack: string): StackFrame[] | undefined {
  const frames: StackFrame[] = [];
  for (const line of stack.slice(0, MAX_STACK_INPUT_LENGTH).split('\n')) {
    const frame = parseStackLine(line);
    if (frame !== undefined) frames.push(frame);
    if (frames.length === MAX_STACK_FRAMES) break;
  }
  return frames.length === 0 ? undefined : frames;
}

function normalizeErrorValue(value: unknown, fallbackMessage: string): NormalizedErrorValue {
  if (typeof value !== 'object' || value === null) {
    return { message: primitiveMessage(value) || fallbackMessage };
  }

  const rawMessage = readProperty(value, 'message');
  const rawName = readProperty(value, 'name');
  const rawStack = readProperty(value, 'stack');
  const message =
    (typeof rawMessage === 'string' && boundedText(rawMessage, MAX_ERROR_MESSAGE_LENGTH)) ||
    fallbackMessage;
  const name =
    typeof rawName === 'string' ? boundedText(rawName, MAX_ERROR_NAME_LENGTH) : undefined;
  const stack = typeof rawStack === 'string' ? parseBrowserStack(rawStack) : undefined;
  return {
    message,
    ...(name ? { name } : {}),
    ...(stack === undefined ? {} : { stack }),
  };
}

function normalizeSource(
  source: { url?: string; line?: number; column?: number } | undefined,
): ErrorPayload['source'] | undefined {
  if (source === undefined) return undefined;
  const url = source.url === undefined ? undefined : sanitizeSourceUrl(source.url);
  const line =
    Number.isSafeInteger(source.line) && (source.line ?? -1) >= 0 ? source.line : undefined;
  const column =
    Number.isSafeInteger(source.column) && (source.column ?? -1) >= 0 ? source.column : undefined;
  if (url === undefined && line === undefined && column === undefined) return undefined;
  return {
    ...(url === undefined ? {} : { url }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

function normalizeFingerprint(fingerprint: string[] | undefined): string[] | undefined {
  if (fingerprint === undefined) return undefined;
  const normalized = fingerprint
    .slice(0, MAX_FINGERPRINT_ITEMS)
    .map((value) => boundedText(value, MAX_FINGERPRINT_ITEM_LENGTH))
    .filter(Boolean);
  return normalized.length === 0 ? undefined : normalized;
}

function payloadFromObservation(observation: BrowserErrorObservation): ErrorPayload {
  if (observation.mechanism === 'resource') {
    const tagName =
      observation.tagName !== undefined && /^[a-z][a-z0-9-]{0,63}$/u.test(observation.tagName)
        ? observation.tagName
        : undefined;
    const sourceUrl =
      observation.url === undefined ? undefined : sanitizeSourceUrl(observation.url);
    return {
      mechanism: 'resource',
      name: 'ResourceLoadError',
      message: `Failed to load${tagName ? ` ${tagName}` : ''} resource`,
      handled: false,
      ...(sourceUrl === undefined ? {} : { source: { url: sourceUrl } }),
    };
  }

  const fallbackMessage =
    observation.mechanism === 'promise' ? 'Unhandled promise rejection' : 'Uncaught runtime error';
  const observedMessage = observation.mechanism === 'runtime' ? observation.message : undefined;
  const normalized = normalizeErrorValue(observation.value, observedMessage || fallbackMessage);
  const source =
    observation.mechanism === 'runtime' ? normalizeSource(observation.source) : undefined;
  return {
    mechanism: observation.mechanism,
    ...normalized,
    handled: false,
    ...(source === undefined ? {} : { source }),
  };
}

export class BrowserErrorCapture {
  readonly #host: ErrorCaptureHost;
  readonly #runtime: BrowserErrorRuntime | undefined;
  readonly #options: BrowserErrorOptions;
  #cleanup: (() => void) | undefined;

  constructor(
    host: ErrorCaptureHost,
    runtime: BrowserErrorRuntime | undefined,
    options: BrowserErrorOptions = {},
  ) {
    this.#host = host;
    this.#runtime = runtime;
    this.#options = options;
  }

  start(): void {
    if (this.#cleanup !== undefined || this.#runtime === undefined) return;
    this.#cleanup = this.#runtime.subscribe((observation) => {
      this.#runSafely(() => {
        if (!this.#isEnabled(observation)) return;
        this.#host.activity();
        this.#host.capture({
          type: 'error',
          name:
            observation.mechanism === 'runtime'
              ? 'runtime_error'
              : observation.mechanism === 'promise'
                ? 'unhandled_rejection'
                : 'resource_error',
          payload: payloadFromObservation(observation),
        });
      });
    });
  }

  captureException(value: unknown, options: CaptureExceptionOptions = {}): string | undefined {
    let eventId: string | undefined;
    this.#runSafely(() => {
      this.#host.activity();
      const normalized = normalizeErrorValue(value, 'Captured non-Error value');
      const fingerprint = normalizeFingerprint(options.fingerprint);
      eventId = this.#host.capture({
        type: 'error',
        name: 'manual_error',
        payload: {
          mechanism: 'manual',
          ...normalized,
          handled: options.handled ?? true,
          ...(fingerprint === undefined ? {} : { fingerprint }),
        },
      });
    });
    return eventId;
  }

  stop(): void {
    const cleanup = this.#cleanup;
    this.#cleanup = undefined;
    if (cleanup === undefined) return;
    this.#runSafely(cleanup);
  }

  #isEnabled(observation: BrowserErrorObservation): boolean {
    if (observation.mechanism === 'runtime') return this.#options.captureRuntimeErrors !== false;
    if (observation.mechanism === 'promise') {
      return this.#options.captureUnhandledRejections !== false;
    }
    return this.#options.captureResourceErrors !== false;
  }

  #runSafely(operation: () => void): void {
    try {
      operation();
    } catch (error) {
      try {
        this.#host.report(error);
      } catch {
        // Error reporting must not escape into the customer page.
      }
    }
  }
}
