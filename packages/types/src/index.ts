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

export interface TransportResult {
  accepted: number;
}

export interface SpectroClientPublic {
  track(name: string, properties?: JSONObject): string | undefined;
  flush(): Promise<FlushResult>;
  getContext(): EventContext;
}
