import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const performance = readFileSync(new URL('./performance-explorer.tsx', import.meta.url), 'utf8');
const network = readFileSync(new URL('./network-explorer.tsx', import.meta.url), 'utf8');
const releases = readFileSync(new URL('./release-health.tsx', import.meta.url), 'utf8');

function rulesFor(selector: string): string[] {
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter((match) => match[1]?.trim() === selector)
    .map((match) => match[2] ?? '');
}

describe('Performance metric label layout', () => {
  it('keeps long metric names padded and unbroken in rows and the detail header', () => {
    const [badge] = rulesFor('.performance-metrics-workspace .metric-badge');
    expect(badge).toContain('padding-inline: 8px;');
    expect(badge).toContain('white-space: nowrap;');
    expect(badge).toContain('flex-shrink: 0;');
  });

  it('sizes the metric column to its content on desktop and mobile without changing Network', () => {
    const [desktop, mobile] = rulesFor('.performance-metrics-workspace .performance-row');
    expect(desktop).toContain('minmax(58px, max-content)');
    expect(mobile).toContain('minmax(52px, max-content)');

    const [sharedDesktop, sharedMobile] = rulesFor('.performance-row');
    expect(sharedDesktop).toContain('grid-template-columns: 58px ');
    expect(sharedMobile).toContain('grid-template-columns: 52px ');
    expect(performance).toMatch(/<main className="[^"]*\bperformance-metrics-workspace\b[^"]*"/u);
    expect(network).not.toContain('performance-metrics-workspace');
    expect(releases).not.toContain('performance-metrics-workspace');
  });

  it('lets long page paths truncate beside the fixed-size detail badge', () => {
    const [copy] = rulesFor('.performance-metrics-workspace .performance-detail > header > div');
    expect(copy).toContain('min-width: 0;');
  });
});
