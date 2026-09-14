import type { ErrorPayload, SpectroEvent } from '../src/index.js';

type AssertFalse<TValue extends false> = TValue;

type MismatchedCustomEvent = {
  id: string;
  type: 'custom';
  name: string;
  version: 1;
  timestamp: number;
  context: SpectroEvent<'custom'>['context'];
  payload: ErrorPayload;
};

type MismatchedPayloadIsRejected = MismatchedCustomEvent extends SpectroEvent ? true : false;

export type ProtocolTypePayloadCorrelation = AssertFalse<MismatchedPayloadIsRejected>;
