import { v7 as uuidv7 } from 'uuid';

import type { CaptureInput, ClientContextInput } from '@spectro/types';
import type { PageContext, SessionContext } from '@spectro/protocol';

import type { BrowserLifecycleRuntime, RawPageSnapshot } from './runtime.js';

export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1_000;
const ACTIVITY_PERSIST_INTERVAL_MS = 60_000;
const SESSION_STORAGE_VERSION = 1;
const MAX_URL_LENGTH = 2_048;
const MAX_TITLE_LENGTH = 512;
const MAX_PAGE_CONTEXT_HISTORY = 32;

interface StoredSession {
  id: string;
  startedAt: number;
  lastActivityAt: number;
}

export interface LifecycleHost {
  capture(input: CaptureInput): string | undefined;
  updateContext(context: ClientContextInput): void;
  report(error: unknown): void;
}

export interface SessionPageLifecycleOptions {
  projectId: string;
  environment: string;
  sessionTimeoutMs?: number;
  clock?: () => number;
  idFactory?: (kind: 'session' | 'page') => string;
}

function defaultIdFactory(kind: 'session' | 'page'): string {
  return `${kind === 'session' ? 'ses' : 'page'}_${uuidv7()}`;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const id: unknown = Reflect.get(value, 'id');
  const startedAt: unknown = Reflect.get(value, 'startedAt');
  const lastActivityAt: unknown = Reflect.get(value, 'lastActivityAt');
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 128 &&
    Number.isSafeInteger(startedAt) &&
    Number.isSafeInteger(lastActivityAt)
  );
}

function safeHashRoute(hash: string): string {
  if (!hash.startsWith('#/')) return '';
  const queryIndex = hash.indexOf('?');
  return queryIndex === -1 ? hash : hash.slice(0, queryIndex);
}

export function sanitizePageUrl(rawUrl: string): { url: string; path: string } | undefined {
  try {
    const parsed = new URL(rawUrl);
    const hashRoute = safeHashRoute(parsed.hash);
    const origin = parsed.origin === 'null' ? parsed.protocol : parsed.origin;
    return {
      url: `${origin}${parsed.pathname}${hashRoute}`.slice(0, MAX_URL_LENGTH),
      path: `${parsed.pathname || '/'}${hashRoute}`.slice(0, MAX_URL_LENGTH),
    };
  } catch {
    return undefined;
  }
}

export function createPageContext(snapshot: RawPageSnapshot, id: string): PageContext {
  const location = sanitizePageUrl(snapshot.href) ?? { url: 'about:blank', path: '/' };
  const title = snapshot.title.trim().slice(0, MAX_TITLE_LENGTH);
  const referrer = sanitizePageUrl(snapshot.referrer)?.url;

  return {
    id,
    ...location,
    ...(title ? { title } : {}),
    ...(referrer ? { referrer } : {}),
  };
}

export class SessionPageLifecycle {
  readonly #host: LifecycleHost;
  readonly #runtime: BrowserLifecycleRuntime;
  readonly #storageKey: string;
  readonly #sessionTimeoutMs: number;
  readonly #clock: () => number;
  readonly #idFactory: (kind: 'session' | 'page') => string;
  readonly #cleanups: Array<() => void> = [];
  readonly #contextsByUrl = new Map<string, ClientContextInput>();
  #session: StoredSession | undefined;
  #page: PageContext | undefined;
  #lastPersistedAt = 0;
  #started = false;

  constructor(
    host: LifecycleHost,
    runtime: BrowserLifecycleRuntime,
    options: SessionPageLifecycleOptions,
  ) {
    this.#host = host;
    this.#runtime = runtime;
    this.#storageKey = `spectro.session.v${SESSION_STORAGE_VERSION}:${options.projectId}:${options.environment}`;
    this.#sessionTimeoutMs = options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.#clock = options.clock ?? Date.now;
    this.#idFactory = options.idFactory ?? defaultIdFactory;

    if (!Number.isFinite(this.#sessionTimeoutMs) || this.#sessionTimeoutMs <= 0) {
      throw new Error('Browser session timeout must be a positive finite number of milliseconds.');
    }
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;

    try {
      const now = this.#clock();
      const existing = this.#readStoredSession(now);
      this.#session = existing ?? this.#newSession(now);
      this.#session.lastActivityAt = now;
      this.#page = createPageContext(this.#runtime.readPage(), this.#idFactory('page'));
      this.#applyContext();
      this.#persistSession(true);

      if (existing === undefined) {
        this.#captureSessionStart(now);
      }
      this.#capturePageView(now);

      this.#cleanups.push(
        this.#runtime.subscribeToNavigation(() => this.#runSafely(() => this.#handleNavigation())),
      );
      this.#cleanups.push(this.#runtime.subscribeToActivity(() => this.touch()));
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  touch(): void {
    this.#runSafely(() => {
      if (!this.#started || this.#session === undefined) return;
      const now = this.#clock();
      if (this.#isExpired(this.#session, now)) {
        this.#session = this.#newSession(now);
        this.#page = createPageContext(this.#runtime.readPage(), this.#idFactory('page'));
        this.#applyContext();
        this.#persistSession(true);
        this.#captureSessionStart(now);
        this.#capturePageView(now);
        return;
      }

      this.#session.lastActivityAt = now;
      this.#persistSession(false);
    });
  }

  stop(): void {
    for (let index = this.#cleanups.length - 1; index >= 0; index -= 1) {
      const cleanup = this.#cleanups[index];
      if (cleanup === undefined) continue;
      try {
        cleanup();
      } catch (error) {
        this.#report(error);
      }
    }
    this.#cleanups.length = 0;
    this.#started = false;
  }

  contextForNavigationUrl(rawUrl?: string): ClientContextInput | undefined {
    if (rawUrl !== undefined) {
      const url = sanitizePageUrl(rawUrl)?.url;
      return url === undefined ? undefined : this.#contextsByUrl.get(url);
    }
    if (this.#session === undefined || this.#page === undefined) return undefined;
    return {
      session: { id: this.#session.id, startedAt: this.#session.startedAt },
      page: this.#page,
    };
  }

  #handleNavigation(): void {
    if (!this.#started || this.#session === undefined || this.#page === undefined) return;
    const nextPage = createPageContext(this.#runtime.readPage(), this.#idFactory('page'));
    if (nextPage.url === this.#page.url) {
      this.touch();
      return;
    }

    const now = this.#clock();
    const from = this.#page.url;
    const expired = this.#isExpired(this.#session, now);
    if (expired) {
      this.#session = this.#newSession(now);
    } else {
      this.#session.lastActivityAt = now;
    }
    this.#page = nextPage;
    this.#applyContext();
    this.#persistSession(true);
    if (expired) {
      this.#captureSessionStart(now);
    }
    this.#host.capture({
      type: 'page',
      name: 'page_route_change',
      timestamp: now,
      payload: { action: 'route_change', from, to: nextPage.url },
    });
  }

  #newSession(now: number): StoredSession {
    return { id: this.#idFactory('session'), startedAt: now, lastActivityAt: now };
  }

  #readStoredSession(now: number): StoredSession | undefined {
    try {
      const stored = this.#runtime.readSessionItem(this.#storageKey);
      if (stored === null) return undefined;
      const parsed: unknown = JSON.parse(stored);
      if (!isStoredSession(parsed) || this.#isExpired(parsed, now)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  #isExpired(session: StoredSession, now: number): boolean {
    return (
      session.startedAt > now ||
      session.lastActivityAt > now ||
      now - session.lastActivityAt >= this.#sessionTimeoutMs
    );
  }

  #persistSession(force: boolean): void {
    if (this.#session === undefined) return;
    const now = this.#clock();
    if (!force && now - this.#lastPersistedAt < ACTIVITY_PERSIST_INTERVAL_MS) return;
    try {
      this.#runtime.writeSessionItem(this.#storageKey, JSON.stringify(this.#session));
      this.#lastPersistedAt = now;
    } catch {
      // sessionStorage can be unavailable; in-memory continuity remains valid for this page.
    }
  }

  #applyContext(): void {
    if (this.#session === undefined || this.#page === undefined) return;
    const session: SessionContext = {
      id: this.#session.id,
      startedAt: this.#session.startedAt,
    };
    const context: ClientContextInput = { session, page: this.#page };
    this.#host.updateContext(context);
    this.#contextsByUrl.delete(this.#page.url);
    this.#contextsByUrl.set(this.#page.url, context);
    while (this.#contextsByUrl.size > MAX_PAGE_CONTEXT_HISTORY) {
      const oldestUrl = this.#contextsByUrl.keys().next().value;
      if (oldestUrl === undefined) break;
      this.#contextsByUrl.delete(oldestUrl);
    }
  }

  #captureSessionStart(timestamp: number): void {
    this.#host.capture({
      type: 'session',
      name: 'session_start',
      timestamp,
      payload: { action: 'start' },
    });
  }

  #capturePageView(timestamp: number): void {
    this.#host.capture({
      type: 'page',
      name: 'page_view',
      timestamp,
      payload: { action: 'view' },
    });
  }

  #runSafely(operation: () => void): void {
    try {
      operation();
    } catch (error) {
      this.#report(error);
    }
  }

  #report(error: unknown): void {
    try {
      this.#host.report(error);
    } catch {
      // Error reporting must not escape into the customer page.
    }
  }
}
