import type { ErrorPayload } from '@spectro/protocol';

import type { CaptureInput } from '../src/index.js';

type AssertFalse<TValue extends false> = TValue;

type MismatchedCaptureInput = {
  type: 'custom';
  name: string;
  payload: ErrorPayload;
};

type MismatchedPayloadIsRejected = MismatchedCaptureInput extends CaptureInput ? true : false;

export type CaptureTypePayloadCorrelation = AssertFalse<MismatchedPayloadIsRejected>;
