// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import markup from '../../landing/index.html?raw';
import { createIllustrativePage } from '../illustrative-events.js';
import { enhanceLanding } from './enhance.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function renderLanding(): Document {
  // Load the actual document structure without asking the DOM harness to fetch CSS.
  return new DOMParser().parseFromString(markup.replace(/<link\b[^>]*>/gu, ''), 'text/html');
}

describe('public landing page', () => {
  it('delivers the content and native examples without a JavaScript render or auth session', () => {
    const page = renderLanding();
    expect(page.querySelector('h1')?.textContent.replace(/\s+/gu, ' ').trim()).toBe(
      'Follow the error',
    );
    expect(page.querySelector('.hero-category')?.textContent).toBe(
      'Frontend observability with shared context.',
    );
    expect(page.querySelectorAll('input[type="radio"][name="signal"]')).toHaveLength(3);
    expect(page.querySelector('#signal-error')?.hasAttribute('checked')).toBe(true);
    expect(page.querySelectorAll('details[name="questions"]')).toHaveLength(4);
    expect(page.querySelector('details[open]')?.textContent).toContain('Browser errors');
    for (const button of page.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
      expect(button.hidden).toBe(true);
    }
    expect(page.querySelectorAll('[data-copy]')).toHaveLength(3);
    expect(page.querySelectorAll('script')).toHaveLength(1);
    expect(page.querySelector('script')?.getAttribute('src')).toBe('/src/landing/main.ts');
    expect(page.querySelectorAll('form, iframe')).toHaveLength(0);
  });

  it('keeps navigation, native control labels and evidence references resolvable', () => {
    const page = renderLanding();
    for (const link of page.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(page.getElementById(link.getAttribute('href')?.slice(1) ?? '')).not.toBeNull();
    }
    for (const input of page.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      expect(page.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
      expect(page.getElementById(input.getAttribute('aria-controls') ?? '')).not.toBeNull();
    }
    const picker = page.querySelector('fieldset.signal-picker');
    expect(picker?.querySelector('legend')?.textContent).toContain('Select an event');
    expect(picker?.contains(page.querySelector('#signal-error'))).toBe(true);
    expect(page.querySelector('.console-link')?.getAttribute('href')).toBe('/');
    expect(page.querySelector('.hero-actions .text-link')?.getAttribute('href')).toBe('#product');
  });

  it('offers a real public application channel without submitting or simulating acceptance', () => {
    const page = renderLanding();
    const actions = page.querySelectorAll<HTMLAnchorElement>('a.button.primary');
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      const url = new URL(action.href);
      expect(url.origin).toBe('https://github.com');
      expect(url.pathname).toBe('/spectro-hq/spectro/issues/new');
      expect(url.searchParams.get('title')).toBe('Early access request');
      const body = url.searchParams.get('body');
      expect(body).toContain('Frontend stack');
      expect(body).toContain('What I want to investigate');
      expect(body).toContain('request is public');
      expect(body).toContain('does not confirm access');
      const explanation = page.getElementById(action.getAttribute('aria-describedby') ?? '');
      expect(explanation?.textContent).toContain('GitHub account is required');
      expect(explanation?.textContent).toContain('public');
      expect(action.textContent).toBe('Request early access');
    }
    expect(actions[0]?.href).toBe(actions[1]?.href);
    expect(page.querySelectorAll('form')).toHaveLength(0);
    expect(page.querySelector('#early-access')?.textContent).toContain('still evolving');
    expect(page.querySelector('#early-access')?.textContent).toContain('private data');
  });

  it('shows the existing synthetic session faithfully without inventing a failed request', () => {
    const page = renderLanding();
    const samples = createIllustrativePage().data.map((item) => item.event);
    const error = samples.find((event) => event.name === 'runtime_error');
    const request = samples.find((event) => event.name === 'fetch_request');
    const click = samples.find((event) => event.name === 'element_click');
    expect(error).toBeDefined();
    expect(request).toBeDefined();
    expect(click).toBeDefined();
    expect(error?.context.session?.id).toBe(request?.context.session?.id);
    expect(error?.context.session?.id).toBe(click?.context.session?.id);
    expect(page.querySelector('#evidence-error')?.textContent).toContain(error?.payload.message);
    expect(request?.payload).toMatchObject({
      response: { status: 200 },
      timing: { duration: 418.2 },
    });
    expect(page.querySelector('#evidence-request')?.textContent).toContain('200');
    expect(page.querySelector('#evidence-request')?.textContent).toContain('418.2 ms');
    expect(click?.payload).toMatchObject({ target: { monitorId: 'submit-order' } });
    expect(page.querySelector('#evidence-click')?.textContent).toContain('submit-order');
    const context = page.querySelector('.session-context')?.textContent ?? '';
    expect(context).toContain(error?.context.session?.id);
    expect(context).toContain(error?.context.page?.id);
    expect(context).toContain(error?.context.release?.version);
    expect(context).toContain(error?.context.page?.path);
    expect(page.querySelector('.instrument-top')?.textContent).toContain('Sample data');
    expect(page.querySelector('.instrument-top')?.textContent).toContain('no telemetry');
    expect(page.querySelector('.evidence-note')?.textContent).toContain('request returned 200');
    expect(page.querySelector('.evidence-note')?.textContent.replace(/\s+/gu, ' ')).toContain(
      'does not establish a cause',
    );
  });

  it('ships local product imagery with descriptions and explicit sample-data provenance', () => {
    const page = renderLanding();
    const captures = page.querySelectorAll<HTMLImageElement>('img[src^="/landing/"]');
    expect(captures).toHaveLength(4);
    for (const capture of captures) {
      expect(capture.alt.length).toBeGreaterThan(30);
      expect(capture.width).toBeGreaterThan(0);
      expect(capture.height).toBeGreaterThan(0);
      expect(
        readFileSync(resolvePath('public', (capture.getAttribute('src') ?? '').slice(1))).length,
      ).toBeGreaterThan(1000);
    }
    expect(page.querySelector('figcaption')?.textContent).toContain('Sample data');
    for (const image of page.querySelectorAll('.proof-image img')) {
      expect(image.closest('figure')?.querySelector('figcaption')?.textContent).toContain(
        'Sample data',
      );
      expect(image.closest('a')?.getAttribute('href')).toBe(image.getAttribute('src'));
    }
    expect(page.querySelectorAll('[src^="https:"], [src^="http:"]')).toHaveLength(0);
    expect(page.querySelector('#sdk-example')?.textContent).toContain('YOUR_BROWSER_WRITE_KEY');
    expect(page.querySelector('#sdk-example')?.textContent).toContain('YOUR_INGESTION_ORIGIN');
  });

  it('matches the alpha SDK setup, privacy boundary and original brand assets', () => {
    const page = renderLanding();
    const browserPackage: unknown = JSON.parse(
      readFileSync('../../packages/browser/package.json', 'utf8'),
    );
    expect(browserPackage).toMatchObject({ version: '0.1.0-alpha.0' });
    expect(page.querySelector('.install-command')?.textContent).toBe(
      'npm install @spectro/browser@0.1.0-alpha.0',
    );
    const setup = page.querySelector('#sdk-example')?.textContent;
    expect(setup).toContain("import { init, track } from '@spectro/browser'");
    expect(setup).toMatch(/^init\(\{$/mu);
    expect(setup).toMatch(/^track\(/mu);
    expect(setup).toMatch(/^  projectId:/mu);
    expect(setup).toContain("endpoint: 'https://YOUR_INGESTION_ORIGIN'");
    expect(setup).not.toContain('/v1/envelope');
    const brief = page.querySelector('#agent-brief-text')?.textContent;
    expect(brief).toContain('@spectro/browser@0.1.0-alpha.0');
    expect(brief).toContain('init()');
    expect(brief).toContain('track()');
    expect(brief).toContain('/v1/envelope');
    expect(brief).toContain(
      'https://github.com/spectro-hq/spectro/blob/main/packages/browser/README.md',
    );
    expect(brief).not.toContain('sk_');
    expect(page.querySelector('[data-copy-target="agent-brief-text"]')).not.toBeNull();
    expect(setup).not.toContain('staging.spectro');
    const privacy = page.querySelector('#privacy')?.textContent.replace(/\s+/gu, ' ');
    for (const exclusion of [
      'passwords',
      'input values',
      'cookies',
      'authorization',
      'bodies',
      'element text',
      'DOM',
      'screen recordings',
    ]) {
      expect(privacy).toContain(exclusion);
    }
    expect(privacy).toContain('explicitly marked');
    const logos = page.querySelectorAll<HTMLImageElement>('.brand img');
    expect(logos).toHaveLength(2);
    for (const logo of logos) {
      expect(logo.getAttribute('src')).toBe('/spectro-logo.png');
      expect(logo.width).toBe(36);
      expect(logo.height).toBe(36);
    }
  });
});

describe('landing clipboard enhancement', () => {
  function setup(copy: (text: string) => Promise<boolean>): {
    buttons: HTMLButtonElement[];
    status: HTMLElement;
    cleanup: () => void;
  } {
    const page = renderLanding();
    page.querySelectorAll('script').forEach((script) => script.remove());
    document.body.innerHTML = page.body.innerHTML;
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-copy]'));
    const status = document.querySelector<HTMLElement>('[data-copy-status]');
    if (buttons.length !== 3 || status === null) throw new Error('Missing copy controls');
    return { buttons, status, cleanup: enhanceLanding(document, copy) };
  }

  it('reveals the copy controls only after enhancement', () => {
    const { buttons, cleanup } = setup(async () => true);
    for (const button of buttons) expect(button.hidden).toBe(false);
    cleanup();
    for (const button of buttons) expect(button.hidden).toBe(true);
  });

  it.each([
    [
      '[data-copy-target="agent-brief-text"]',
      '#agent-brief-text',
      'Agent brief copied. Paste it into your coding agent.',
      'Integrate the Spectro browser SDK',
    ],
    [
      '[data-copy-target="install-command"]',
      '#install-command',
      'Install command copied.',
      'npm install @spectro/browser@0.1.0-alpha.0',
    ],
    [
      '[data-copy-target="sdk-example"]',
      '#sdk-example',
      'Code copied. Replace the example values with your project settings.',
      "import { init, track } from '@spectro/browser'",
    ],
  ] as const)('copies %s target as plain text', async (selector, targetId, message, needle) => {
    const copy = vi.fn<(value: string) => Promise<boolean>>(async () => true);
    const { buttons, status, cleanup } = setup(copy);
    const button = buttons.find((candidate) => candidate.matches(selector));
    expect(button).toBeDefined();
    button?.click();
    await vi.waitFor(() => expect(status.textContent).toContain(message));
    expect(copy).toHaveBeenCalledWith(document.querySelector(targetId)?.textContent);
    expect(copy.mock.calls[0]?.[0]).toContain(needle);
    expect(copy.mock.calls[0]?.[0]).not.toContain('<');
    expect(button?.classList.contains('is-copied')).toBe(true);
    expect(status.classList.contains('is-shown')).toBe(false);
    expect(button?.disabled).toBe(false);
    cleanup();
    expect(button?.classList.contains('is-copied')).toBe(false);
  });

  it.each(['denied', 'unavailable'])('preserves manual copy when %s', async (failure) => {
    const { buttons, status, cleanup } = setup(async () => {
      if (failure === 'denied') throw new Error('Clipboard permission denied');
      return false;
    });
    for (const button of buttons) button.click();
    await vi.waitFor(() => expect(status.textContent).toContain('copy it manually'));
    expect(status.classList.contains('is-shown')).toBe(true);
    for (const button of buttons) expect(button.disabled).toBe(false);
    expect(document.querySelector('#sdk-example')?.textContent).toContain('init({');
    cleanup();
  });

  it('prevents overlapping writes and ignores completion after cleanup', async () => {
    let complete: ((success: boolean) => void) | undefined;
    const copy = vi.fn<() => Promise<boolean>>(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        }),
    );
    const { buttons, status, cleanup } = setup(copy);
    const button = buttons.find((candidate) =>
      candidate.matches('[data-copy-target="sdk-example"]'),
    );
    button?.click();
    button?.dispatchEvent(new MouseEvent('click'));
    expect(copy).toHaveBeenCalledTimes(1);
    cleanup();
    complete?.(true);
    await Promise.resolve();
    expect(status.textContent).toBe('');
    for (const candidate of buttons) expect(candidate.hidden).toBe(true);
  });
});

describe('landing spine enhancement', () => {
  function mount(): Document {
    const page = renderLanding();
    page.querySelectorAll('script').forEach((script) => script.remove());
    document.body.innerHTML = page.body.innerHTML;
    return document;
  }

  it('is a no-op when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    mount();
    const cleanup = enhanceLanding(document, async () => true);
    expect(() => cleanup()).not.toThrow();
  });

  it('toggles section activity and disconnects on cleanup', () => {
    const observed: Element[] = [];
    const disconnect = vi.fn<() => void>();
    let callback: IntersectionObserverCallback | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe(element: Element): void {
          observed.push(element);
        }
        unobserve(): void {}
        disconnect(): void {
          disconnect();
        }
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
      },
    );
    mount();
    const cleanup = enhanceLanding(document, async () => true);
    const sections = document.querySelectorAll('section');
    expect(observed.length).toBe(sections.length);
    const product = document.getElementById('product');
    expect(product).not.toBeNull();
    const productLink = document.querySelector<HTMLAnchorElement>(
      '.site-header nav a[href="#product"]',
    );
    const sdkLink = document.querySelector<HTMLAnchorElement>(
      '.site-header nav a[href="#developers"]',
    );
    callback?.(
      [{ target: product, isIntersecting: true } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(product?.classList.contains('is-active')).toBe(true);
    expect(productLink?.getAttribute('aria-current')).toBe('location');
    expect(sdkLink?.getAttribute('aria-current')).toBeNull();
    callback?.(
      [{ target: product, isIntersecting: false } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(product?.classList.contains('is-active')).toBe(false);
    expect(productLink?.getAttribute('aria-current')).toBeNull();
    cleanup();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(productLink?.getAttribute('aria-current')).toBeNull();
  });

  it('adds the scrolled treatment to the header and removes listener and class on cleanup', () => {
    mount();
    const header = document.querySelector<HTMLElement>('.site-header');
    expect(header).not.toBeNull();
    const cleanup = enhanceLanding(document, async () => true);
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(header?.classList.contains('is-scrolled')).toBe(true);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    expect(header?.classList.contains('is-scrolled')).toBe(false);
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    cleanup();
    expect(header?.classList.contains('is-scrolled')).toBe(false);
    window.dispatchEvent(new Event('scroll'));
    expect(header?.classList.contains('is-scrolled')).toBe(false);
  });
});
