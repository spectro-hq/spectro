import { createHash } from 'node:crypto';

import { validateEnvelope, type Envelope } from '@spectro/protocol';

export const ADMITTED_STREAM = 'SPECTRO_ADMITTED';
export const ADMITTED_SUBJECT = 'spectro.admitted.v1';
export const PROCESSOR_CONSUMER = 'spectro-processor-v1';
export const ENVELOPE_ID_HEADER = 'Spectro-Envelope-Id';
export const ADMITTED_AT_HEADER = 'Spectro-Admitted-At';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface AdmissionMetadata {
  envelopeId: string;
  admittedAt: number;
}

export interface AdmittedEnvelope extends AdmissionMetadata {
  envelope: Envelope;
}

export class InvalidAdmittedEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAdmittedEnvelopeError';
  }
}

export function createEnvelopeId(envelope: Envelope): string {
  const identity = [
    `envelope-v${envelope.version}`,
    String(envelope.sentAt),
    ...envelope.items.map((item) => item.payload.id),
  ].join('\n');

  return createHash('sha256').update(identity).digest('hex').slice(0, 32);
}

export function createAdmissionMetadata(
  envelope: Envelope,
  admittedAt: number = Date.now(),
): AdmissionMetadata {
  return { envelopeId: createEnvelopeId(envelope), admittedAt };
}

export function encodeEnvelope(envelope: Envelope): Uint8Array {
  return encoder.encode(JSON.stringify(envelope));
}

export function decodeAdmittedEnvelope(
  data: Uint8Array,
  metadata: AdmissionMetadata,
): AdmittedEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(data));
  } catch {
    throw new InvalidAdmittedEnvelopeError('The admitted envelope is not valid UTF-8 JSON.');
  }

  const validation = validateEnvelope(raw);
  if (!validation.success) {
    throw new InvalidAdmittedEnvelopeError('The admitted envelope does not match Protocol V1.');
  }
  if (createEnvelopeId(validation.data) !== metadata.envelopeId) {
    throw new InvalidAdmittedEnvelopeError(
      'The admitted envelope identity does not match its content.',
    );
  }
  if (!Number.isSafeInteger(metadata.admittedAt) || metadata.admittedAt < 0) {
    throw new InvalidAdmittedEnvelopeError('The admitted timestamp is invalid.');
  }

  return { ...metadata, envelope: validation.data };
}
