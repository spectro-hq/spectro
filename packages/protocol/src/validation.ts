import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import commonSchema from '../schemas/common.schema.json' with { type: 'json' };
import customSchema from '../schemas/custom.schema.json' with { type: 'json' };
import envelopeSchema from '../schemas/envelope.schema.json' with { type: 'json' };
import errorSchema from '../schemas/error.schema.json' with { type: 'json' };
import eventSchema from '../schemas/event.schema.json' with { type: 'json' };
import interactionSchema from '../schemas/interaction.schema.json' with { type: 'json' };
import networkSchema from '../schemas/network.schema.json' with { type: 'json' };
import pageSchema from '../schemas/page.schema.json' with { type: 'json' };
import performanceSchema from '../schemas/performance.schema.json' with { type: 'json' };
import sessionSchema from '../schemas/session.schema.json' with { type: 'json' };

import type { Envelope, SpectroEvent } from './types.js';
import { MAX_ENVELOPE_STRUCTURE_DEPTH, MAX_JSON_DEPTH } from './types.js';

export interface ValidationIssue {
  path: string;
  keyword: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

const ajv = new Ajv2020({ allErrors: true, strict: true });

for (const schema of [
  commonSchema,
  customSchema,
  errorSchema,
  performanceSchema,
  networkSchema,
  interactionSchema,
  sessionSchema,
  pageSchema,
  eventSchema,
  envelopeSchema,
]) {
  ajv.addSchema(schema);
}

const eventValidator = ajv.getSchema(eventSchema.$id) as ValidateFunction<SpectroEvent>;
const envelopeValidator = ajv.getSchema(envelopeSchema.$id) as ValidateFunction<Envelope>;

function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message ?? 'is invalid',
  }));
}

function runValidation<T>(validator: ValidateFunction<T>, input: unknown): ValidationResult<T> {
  if (validator(input)) {
    return { success: true, data: input };
  }

  return { success: false, issues: toIssues(validator.errors) };
}

function maxDepthIssue(message: string): ValidationResult<never> {
  return {
    success: false,
    issues: [{ path: '/', keyword: 'maxDepth', message }],
  };
}

function recursiveJsonFieldsAreBounded(event: SpectroEvent): boolean {
  if (event.context.user?.traits && !isJsonDepthWithin(event.context.user.traits, MAX_JSON_DEPTH)) {
    return false;
  }
  if (event.type === 'custom' && !isJsonDepthWithin(event.payload.properties, MAX_JSON_DEPTH)) {
    return false;
  }
  if (
    event.type === 'performance' &&
    event.payload.attribution &&
    !isJsonDepthWithin(event.payload.attribution, MAX_JSON_DEPTH)
  ) {
    return false;
  }
  return true;
}

export function validateEvent(input: unknown): ValidationResult<SpectroEvent> {
  if (!isJsonDepthWithin(input, MAX_ENVELOPE_STRUCTURE_DEPTH)) {
    return maxDepthIssue('exceeds the maximum structural depth');
  }

  const result = runValidation(eventValidator, input);
  if (result.success && !recursiveJsonFieldsAreBounded(result.data)) {
    return maxDepthIssue(`contains a recursive JSON field deeper than ${MAX_JSON_DEPTH}`);
  }
  return result;
}

export function validateEnvelope(input: unknown): ValidationResult<Envelope> {
  if (!isJsonDepthWithin(input, MAX_ENVELOPE_STRUCTURE_DEPTH)) {
    return maxDepthIssue('exceeds the maximum structural depth');
  }

  const result = runValidation(envelopeValidator, input);
  if (
    result.success &&
    result.data.items.some((item) => !recursiveJsonFieldsAreBounded(item.payload))
  ) {
    return maxDepthIssue(`contains a recursive JSON field deeper than ${MAX_JSON_DEPTH}`);
  }
  return result;
}

export function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function isJsonDepthWithin(value: unknown, maxDepth: number, depth = 0): boolean {
  const pending: Array<{ depth: number; value: unknown }> = [{ depth, value }];
  const seen = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.value === null || typeof current.value !== 'object') {
      continue;
    }

    if (seen.has(current.value)) {
      return false;
    }
    seen.add(current.value);

    const children = Object.values(current.value);
    if (current.depth >= maxDepth && children.length > 0) {
      return false;
    }

    for (const child of children) {
      pending.push({ depth: current.depth + 1, value: child });
    }
  }

  return true;
}
