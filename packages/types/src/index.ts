import type {
  BrowserContext,
  DeviceContext,
  EventContext,
  EventPayloadByType,
  EventType,
  JSONObject,
  OSContext,
  PageContext,
  SessionContext,
  TraceContext,
  UserContext,
} from '@spectro/protocol';

type CaptureInputOfType<TType extends EventType> = {
  type: TType;
  name: string;
  payload: EventPayloadByType[TType];
  timestamp?: number;
  context?: ClientContextInput;
};

export type CaptureInput<TType extends EventType = EventType> = TType extends EventType
  ? CaptureInputOfType<TType>
  : never;

export interface ClientContextInput {
  session?: SessionContext;
  user?: UserContext;
  page?: PageContext;
  device?: DeviceContext;
  browser?: BrowserContext;
  os?: OSContext;
  trace?: TraceContext;
  tags?: Record<string, string>;
}

export interface SpectroClientOptions extends ClientContextInput {
  projectId: string;
  apiKey: string;
  environment: string;
  endpoint: string;
  onError?: (error: Error) => void;
  release?: string;
  sdk?: {
    name: string;
    version: string;
  };
}

export interface FlushResult {
  sent: number;
  remaining: number;
}

export type DeliveryPriority = 'immediate' | 'batch';

export interface CaptureOptions {
  priority?: DeliveryPriority;
}

export interface QueuedEventRecord {
  event: import('@spectro/protocol').SpectroEvent;
  priority: DeliveryPriority;
  attempts: number;
}

export interface EventQueueScope {
  projectId: string;
  environment: string;
}

export interface DurableEventQueue {
  load(scope: EventQueueScope): Promise<readonly QueuedEventRecord[]>;
  save(scope: EventQueueScope, records: readonly QueuedEventRecord[]): Promise<number>;
  remove(scope: EventQueueScope, eventIds: readonly string[]): Promise<void>;
}

export const MAX_KEEPALIVE_ENVELOPE_BYTES = 60 * 1_024;

export interface FlushOptions {
  keepalive?: boolean;
  priority?: DeliveryPriority;
}

export interface TransportResult {
  accepted: number;
}

export interface SpectroClientPublic {
  track(name: string, properties?: JSONObject): string | undefined;
  flush(options?: FlushOptions): Promise<FlushResult>;
  getContext(): EventContext;
}
