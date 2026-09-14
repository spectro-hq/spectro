import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserErrorRuntime, type BrowserErrorObservation } from '../src/error-runtime.js';

afterEach(() => vi.unstubAllGlobals());

describe('browser error runtime', () => {
  it('adapts browser events without changing their default behavior and cleans up listeners', () => {
    const listeners = new Map<string, Set<(event: object) => void>>();
    const fakeWindow = {
      addEventListener(type: string, listener: (event: object) => void) {
        const existing = listeners.get(type) ?? new Set<(event: object) => void>();
        existing.add(listener);
        listeners.set(type, existing);
      },
      removeEventListener(type: string, listener: (event: object) => void) {
        listeners.get(type)?.delete(listener);
      },
    };
    vi.stubGlobal('window', fakeWindow);
    const observations: BrowserErrorObservation[] = [];
    const runtime = createBrowserErrorRuntime();
    const cleanup = runtime?.subscribe((observation) => observations.push(observation));

    for (const listener of listeners.get('error') ?? []) {
      listener({
        message: 'Uncaught failure',
        error: new Error('failure'),
        filename: 'https://app.example/app.js?token=private',
        lineno: 4,
        colno: 8,
      });
      listener({
        target: {
          tagName: 'SCRIPT',
          currentSrc: 'https://cdn.example/app.js?token=private',
          textContent: 'must not be inspected',
        },
      });
    }
    for (const listener of listeners.get('unhandledrejection') ?? []) {
      listener({ reason: 'promise failed' });
    }

    expect(observations).toEqual([
      {
        mechanism: 'runtime',
        value: expect.any(Error),
        message: 'Uncaught failure',
        source: {
          url: 'https://app.example/app.js?token=private',
          line: 4,
          column: 8,
        },
      },
      {
        mechanism: 'resource',
        tagName: 'script',
        url: 'https://cdn.example/app.js?token=private',
      },
      { mechanism: 'promise', value: 'promise failed' },
    ]);

    cleanup?.();
    expect(listeners.get('error')?.size).toBe(0);
    expect(listeners.get('unhandledrejection')?.size).toBe(0);
  });
});
