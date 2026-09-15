import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserInteractionRuntime,
  type BrowserInteractionObservation,
} from '../src/interaction-runtime.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function monitoredElement(monitorId: string, tagName = 'BUTTON') {
  return {
    tagName,
    getAttribute(name: string) {
      if (name === 'data-spectro-monitor-id') return monitorId;
      if (name === 'role') return tagName === 'BUTTON' ? 'button' : null;
      return null;
    },
  };
}

function documentHarness() {
  const events = new EventTarget();
  return {
    browserDocument: {
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

function browserEvent(
  kind: 'click' | 'submit',
  path: unknown[],
  coordinates?: { x: number; y: number },
): Event {
  const event = new Event(kind, { cancelable: true });
  Object.defineProperties(event, {
    composedPath: { value: () => path },
    ...(coordinates === undefined
      ? {}
      : {
          clientX: { value: coordinates.x },
          clientY: { value: coordinates.y },
        }),
  });
  return event;
}

describe('browser interaction runtime', () => {
  it('delegates marked clicks without coordinates by default and removes listeners', () => {
    const events = documentHarness();
    vi.stubGlobal('document', events.browserDocument);
    const runtime = createBrowserInteractionRuntime();
    const observations: BrowserInteractionObservation[] = [];
    const cleanup = runtime?.subscribe(
      (observation) => observations.push(observation),
      () => {},
      { captureClicks: true, captureFormSubmits: false, captureCoordinates: false },
    );
    const event = browserEvent('click', [
      { getAttribute: () => null },
      monitoredElement('checkout_button'),
    ]);

    expect(events.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(observations).toEqual([
      {
        kind: 'click',
        target: { monitorId: 'checkout_button', tag: 'button', role: 'button' },
      },
    ]);

    cleanup?.();
    events.dispatchEvent(browserEvent('click', [monitoredElement('after_destroy')]));
    expect(observations).toHaveLength(1);
  });

  it('captures opt-in click coordinates and marked form submissions', () => {
    const events = documentHarness();
    vi.stubGlobal('document', events.browserDocument);
    const runtime = createBrowserInteractionRuntime();
    const observations: BrowserInteractionObservation[] = [];
    const cleanup = runtime?.subscribe(
      (observation) => observations.push(observation),
      () => {},
      { captureClicks: true, captureFormSubmits: true, captureCoordinates: true },
    );

    events.dispatchEvent(browserEvent('click', [monitoredElement('hero_cta')], { x: 120, y: 240 }));
    events.dispatchEvent(browserEvent('submit', [monitoredElement('checkout_form', 'FORM')]));
    events.dispatchEvent(browserEvent('click', [{ getAttribute: () => null }]));

    expect(observations).toEqual([
      {
        kind: 'click',
        target: { monitorId: 'hero_cta', tag: 'button', role: 'button' },
        coordinates: { x: 120, y: 240 },
      },
      {
        kind: 'submit',
        target: { monitorId: 'checkout_form', tag: 'form' },
      },
    ]);
    cleanup?.();
  });

  it('contains subscriber failures without interrupting the host event', () => {
    const events = documentHarness();
    vi.stubGlobal('document', events.browserDocument);
    const runtime = createBrowserInteractionRuntime();
    const errors: unknown[] = [];
    const failure = new Error('capture unavailable');
    const cleanup = runtime?.subscribe(
      () => {
        throw failure;
      },
      (error) => errors.push(error),
      { captureClicks: true, captureFormSubmits: false, captureCoordinates: false },
    );

    expect(() =>
      events.dispatchEvent(browserEvent('click', [monitoredElement('safe_button')])),
    ).not.toThrow();
    expect(errors).toEqual([failure]);
    cleanup?.();
  });
});
