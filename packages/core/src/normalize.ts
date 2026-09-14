import { MAX_JSON_DEPTH, type JSONObject, type JSONValue } from '@spectro/protocol';

import { SpectroValidationError } from './errors.js';

const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const MAX_STRING_LENGTH = 2048;
const SENSITIVE_KEYS = new Set(['body', 'input', 'payload']);
const SENSITIVE_KEY_FRAGMENTS = [
  'apikey',
  'authtoken',
  'authheader',
  'authorization',
  'cookie',
  'inputvalue',
  'password',
  'passwd',
  'requestbody',
  'requestpayload',
  'responsebody',
  'responsepayload',
  'secret',
  'setcookie',
] as const;

export function isSensitivePropertyKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    SENSITIVE_KEYS.has(normalized) ||
    SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))
  );
}

function normalize(value: unknown, depth: number, seen: WeakSet<object>): JSONValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new SpectroValidationError(
      `Custom properties exceed the maximum depth of ${MAX_JSON_DEPTH}`,
    );
  }

  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.slice(0, MAX_STRING_LENGTH);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SpectroValidationError('Custom properties must contain finite numbers');
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw new SpectroValidationError(`Unsupported custom property value: ${typeof value}`);
  }

  if (value instanceof Date) {
    throw new SpectroValidationError(
      'Date instances must be converted to JSON values before capture',
    );
  }

  if (seen.has(value)) {
    throw new SpectroValidationError('Custom properties cannot contain cyclic references');
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY_ITEMS).map((item) => normalize(item, depth + 1, seen));
    }

    const output: JSONObject = {};
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
    for (const [key, item] of entries) {
      if (isSensitivePropertyKey(key)) {
        continue;
      }
      output[key.slice(0, 128)] = normalize(item, depth + 1, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

export function normalizeProperties(properties: JSONObject): JSONObject {
  return normalize(properties, 0, new WeakSet()) as JSONObject;
}

export function normalizeTags(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tags)
      .filter(([key]) => !isSensitivePropertyKey(key))
      .slice(0, 50)
      .map(([key, value]) => [key.slice(0, 64), value.slice(0, 256)]),
  );
}
