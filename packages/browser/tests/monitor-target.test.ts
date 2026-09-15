import { describe, expect, it } from 'vitest';

import {
  createMonitoredTarget,
  findMonitoredTarget,
  readMonitorId,
} from '../src/monitor-target.js';

function element(
  monitorId: string | null,
  options: { tagName?: string; role?: string | null; parentElement?: unknown } = {},
) {
  return {
    tagName: options.tagName ?? 'BUTTON',
    parentElement: options.parentElement ?? null,
    getAttribute(name: string) {
      if (name === 'data-spectro-monitor-id') return monitorId;
      if (name === 'role') return options.role ?? null;
      return null;
    },
  };
}

describe('monitor target privacy', () => {
  it('retains only an explicit valid monitor ID and bounded target tokens', () => {
    expect(createMonitoredTarget(element('checkout_button', { role: 'Button' }))).toEqual({
      monitorId: 'checkout_button',
      tag: 'button',
      role: 'button',
    });
    expect(readMonitorId(element('email@example.com'))).toBeUndefined();
    expect(createMonitoredTarget(element('checkout', { role: 'private value' }))).toEqual({
      monitorId: 'checkout',
      tag: 'button',
    });
  });

  it('finds a marked ancestor through composedPath without reading private DOM fields', () => {
    const attributes: string[] = [];
    const monitored = {
      tagName: 'A',
      getAttribute(name: string) {
        attributes.push(name);
        if (name === 'data-spectro-monitor-id') return 'pricing_link';
        if (name === 'role') return 'link';
        throw new Error(`Unexpected attribute ${name}`);
      },
    };
    const privateChild = {
      get textContent(): never {
        throw new Error('Private text must not be read');
      },
      getAttribute: () => null,
    };

    expect(findMonitoredTarget({ composedPath: () => [privateChild, monitored] })).toEqual({
      monitorId: 'pricing_link',
      tag: 'a',
      role: 'link',
    });
    expect(attributes).toEqual(['data-spectro-monitor-id', 'role']);
  });

  it('falls back to bounded parent traversal and contains hostile properties', () => {
    const parent = element('submit_order', { tagName: 'FORM' });
    const child = element(null, { tagName: 'SPAN', parentElement: parent });
    expect(findMonitoredTarget({ target: child })).toEqual({
      monitorId: 'submit_order',
      tag: 'form',
    });

    const hostile = {
      get getAttribute(): never {
        throw new Error('DOM unavailable');
      },
      get parentElement(): never {
        throw new Error('DOM unavailable');
      },
    };
    expect(() => findMonitoredTarget({ target: hostile })).not.toThrow();
    expect(findMonitoredTarget({ target: hostile })).toBeUndefined();
  });
});
