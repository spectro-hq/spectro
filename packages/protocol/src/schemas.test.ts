import { describe, expect, it } from 'vitest';
import { protocolSchemas } from './index.js';
import errorSchema from '../schemas/error.schema.json' with { type: 'json' };
import commonSchema from '../schemas/common.schema.json' with { type: 'json' };

describe('public protocol schema registry', () => {
  it('exports original sources, not a reconstructed field model', () => {
    expect(protocolSchemas.error).toBe(errorSchema);
    expect(protocolSchemas.common).toBe(commonSchema);
    expect(Object.keys(protocolSchemas)).toHaveLength(10);
    for (const [name, document] of Object.entries(protocolSchemas)) {
      expect(document.$id).toBe(`https://spectro.dev/schemas/${name}.schema.json`);
      expect(document.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    }
  });
});
