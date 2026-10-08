import {
  MAX_EVENT_BYTES,
  MAX_ENVELOPE_BYTES,
  serializedByteLength,
  validateEvent,
  validateEnvelope,
} from '@spectro/protocol';
import { describe, expect, it } from 'vitest';
import { schemaContracts } from './schema-catalogue.js';
import { schemaExample, schemaExampleEnvelope, schemaExampleEvents } from './schema-examples.js';

describe('synthetic protocol examples', () => {
  it.each(Object.entries(schemaExampleEvents))(
    '%s passes the real strict validator and event byte limit',
    (_type, event) => {
      expect(validateEvent(event)).toEqual({ success: true, data: event });
      expect(serializedByteLength(event)).toBeLessThan(MAX_EVENT_BYTES);
      const invalid = structuredClone(event);
      invalid.name = 'Invalid Event';
      expect(validateEvent(invalid).success).toBe(false);
    },
  );
  it('validates the complete envelope across its event boundary', () => {
    expect(validateEnvelope(schemaExampleEnvelope).success).toBe(true);
    expect(serializedByteLength(schemaExampleEnvelope)).toBeLessThan(MAX_ENVELOPE_BYTES);
    expect(validateEnvelope({ ...schemaExampleEnvelope, items: [] }).success).toBe(false);
  });
  it('selects actual validated subdocuments for every view, with no live project data or secrets', () => {
    for (const { id } of schemaContracts) expect(schemaExample(id)).toBeDefined();
    expect(schemaExample('error')).toBe(schemaExampleEvents.error.payload);
    expect(schemaExample('context')).toBe(schemaExampleEvents.error.context);
    expect(schemaExample('event')).toBe(schemaExampleEvents.error);
    const serialized = JSON.stringify(schemaExampleEvents);
    expect(serialized).not.toMatch(/authorization|password|cookie|email|traits|prj_EFex|spk_/i);
    for (const event of Object.values(schemaExampleEvents)) {
      expect(event.context.project.id).toBe('prj_example');
      expect(event.context.page?.url).toBe('https://app.example/checkout');
      expect(event.context.user).toBeUndefined();
    }
  });
});
