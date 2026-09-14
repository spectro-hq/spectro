import { createHash } from 'node:crypto';

import type { ErrorPayload, StackFrame } from '@spectro/protocol';

const FINGERPRINT_VERSION = 1 as const;
const MAX_GROUPING_FRAMES = 5;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const HEX_PATTERN = /\b0x[0-9a-f]+\b/giu;
const NUMBER_PATTERN = /\b\d+\b/gu;

function normalizeVolatileText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(UUID_PATTERN, '<uuid>')
    .replace(HEX_PATTERN, '<hex>')
    .replace(NUMBER_PATTERN, '<number>')
    .replace(/\s+/gu, ' ');
}

function normalizeFilename(value: string): string {
  const withoutQuery = value.split(/[?#]/u, 1)[0] ?? value;
  return normalizeVolatileText(withoutQuery);
}

function selectGroupingFrames(frames: readonly StackFrame[]): readonly StackFrame[] {
  const inAppFrames = frames.filter((frame) => frame.inApp === true);
  return (inAppFrames.length > 0 ? inAppFrames : frames).slice(0, MAX_GROUPING_FRAMES);
}

function frameGroupingKey(frame: StackFrame): string {
  const filename = frame.filename === undefined ? '' : normalizeFilename(frame.filename);
  const functionName = frame.function === undefined ? '' : normalizeVolatileText(frame.function);
  return `${filename}:${functionName}`;
}

export function createErrorFingerprint(payload: ErrorPayload): string {
  const hintKey = payload.fingerprint?.map(normalizeVolatileText).join('|');
  const groupingKey =
    hintKey === undefined || hintKey.length === 0
      ? [
          normalizeVolatileText(payload.name ?? 'error'),
          normalizeVolatileText(payload.message),
          ...selectGroupingFrames(payload.stack ?? []).map(frameGroupingKey),
        ].join('|')
      : `hint|${hintKey}`;

  return createHash('sha256')
    .update(`spectro-error-v${FINGERPRINT_VERSION}|${groupingKey}`)
    .digest('hex')
    .slice(0, 32);
}
