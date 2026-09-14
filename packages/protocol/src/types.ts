export const EVENT_VERSION = 1 as const;
export const ENVELOPE_VERSION = 1 as const;
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const MAX_EVENT_BYTES = 64 * 1024;
export const MAX_ENVELOPE_BYTES = 1024 * 1024;
export const MAX_JSON_DEPTH = 5;
export const MAX_ENVELOPE_STRUCTURE_DEPTH = 16;

export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type JSONObject = { [key: string]: JSONValue };

export type EventType =
  | 'session'
  | 'page'
  | 'error'
  | 'performance'
  | 'network'
  | 'interaction'
  | 'custom';

export interface SDKContext {
  name: string;
  version: string;
}

export interface ProjectContext {
  id: string;
}

export interface SessionContext {
  id: string;
  startedAt?: number;
}

export interface UserContext {
  id?: string;
  anonymousId: string;
  traits?: JSONObject;
}

export interface PageContext {
  id: string;
  url: string;
  path: string;
  title?: string;
  referrer?: string;
}

export interface DeviceContext {
  type?: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  model?: string;
}

export interface BrowserContext {
  name?: string;
  version?: string;
}

export interface OSContext {
  name?: string;
  version?: string;
}

export interface ReleaseContext {
  version: string;
}

export interface TraceContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
}

export interface EventContext {
  sdk: SDKContext;
  project: ProjectContext;
  environment: string;
  session?: SessionContext;
  user?: UserContext;
  page?: PageContext;
  device?: DeviceContext;
  browser?: BrowserContext;
  os?: OSContext;
  release?: ReleaseContext;
  trace?: TraceContext;
  tags?: Record<string, string>;
}

export interface StackFrame {
  filename?: string;
  function?: string;
  line?: number;
  column?: number;
  inApp?: boolean;
}

export interface ErrorPayload {
  mechanism: 'runtime' | 'promise' | 'resource' | 'manual';
  name?: string;
  message: string;
  stack?: StackFrame[];
  fingerprint?: string[];
  handled: boolean;
  source?: { url?: string; line?: number; column?: number };
}

export interface PerformancePayload {
  metric: 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb' | 'long_task' | 'navigation' | 'resource_timing';
  value: number;
  unit: 'ms' | 'score';
  rating?: 'good' | 'needs_improvement' | 'poor';
  navigationType?: string;
  attribution?: JSONObject;
}

export interface NetworkPayload {
  request: { method: string; url: string };
  response?: { status: number };
  timing: { start: number; duration: number };
  initiator: 'fetch' | 'xhr' | 'resource';
  success: boolean;
}

export interface InteractionPayload {
  target?: {
    tag?: string;
    id?: string;
    role?: string;
    selector?: string;
    monitorId?: string;
  };
  coordinates?: { x: number; y: number };
}

export interface CustomEventPayload {
  properties: JSONObject;
}

export interface SessionPayload {
  action: 'start' | 'end';
  duration?: number;
}

export interface PagePayload {
  action: 'view' | 'route_change' | 'leave';
  from?: string;
  to?: string;
}

export interface EventPayloadByType {
  session: SessionPayload;
  page: PagePayload;
  error: ErrorPayload;
  performance: PerformancePayload;
  network: NetworkPayload;
  interaction: InteractionPayload;
  custom: CustomEventPayload;
}

type SpectroEventOfType<TType extends EventType> = {
  id: string;
  type: TType;
  name: string;
  version: typeof EVENT_VERSION;
  timestamp: number;
  context: EventContext;
  payload: EventPayloadByType[TType];
};

export type SpectroEvent<TType extends EventType = EventType> = TType extends EventType
  ? SpectroEventOfType<TType>
  : never;

export interface EventEnvelopeItem {
  type: 'event';
  payload: SpectroEvent;
}

export interface Envelope {
  version: typeof ENVELOPE_VERSION;
  sentAt: number;
  items: EventEnvelopeItem[];
}
