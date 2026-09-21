import { describe, expect, it } from 'vitest';

import { formatPayload } from './payload-viewer.js';

const payload = {
  name: 'TypeError',
  handled: false,
  location: { line: 412, path: '/checkout' },
  tags: ['runtime', 'checkout'],
  cause: null,
};

describe('formatPayload', () => {
  it('formats nested payloads as readable JSON', () => {
    expect(formatPayload(payload, 'json')).toBe(JSON.stringify(payload, null, 2));
  });

  it('formats nested payloads as valid YAML-compatible text', () => {
    expect(formatPayload(payload, 'yaml')).toBe(`"name": "TypeError"
"handled": false
"location":
  "line": 412
  "path": "/checkout"
"tags":
  - "runtime"
  - "checkout"
"cause": null`);
  });
});
