import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const detail = readFileSync(new URL('./event-detail.tsx', import.meta.url), 'utf8');

function ruleFor(selector: string): string {
  return (
    [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].find(
      (match) => match[1]?.trim() === selector,
    )?.[2] ?? ''
  );
}

describe('Event detail title alignment', () => {
  it('centers the signal in the title row, independently of the summary', () => {
    expect(detail).toMatch(
      /className="detail-title">\s*<span[^>]+aria-hidden="true"\s*\/>\s*<h2[^>]*>[^<]*<\/h2>\s*<\/div>\s*<p>/u,
    );
    expect(ruleFor('.detail-title')).toContain('align-items: center;');
    expect(ruleFor('.detail-signal')).not.toContain('margin-top:');
  });

  it('keeps long names truncatable and the summary aligned with the name', () => {
    expect(ruleFor('.detail-identity h2')).toContain('min-width: 0;');
    expect(ruleFor('.detail-identity h2')).toContain('text-overflow: ellipsis;');
    expect(ruleFor('.detail-title')).toContain('gap: 11px;');
    expect(ruleFor('.detail-signal')).toContain('width: 11px;');
    expect(ruleFor('.detail-identity p')).toContain('padding-left: 22px;');
  });
});
