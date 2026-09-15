const MONITOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;
const TARGET_TOKEN_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const MAX_TARGET_DEPTH = 20;

export interface MonitoredTarget {
  monitorId: string;
  tag?: string;
  role?: string;
}

function readProperty(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function readAttribute(node: object, name: string): unknown {
  try {
    const getAttribute = Reflect.get(node, 'getAttribute');
    return typeof getAttribute === 'function'
      ? Reflect.apply(getAttribute, node, [name])
      : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeMonitorId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 120 &&
    MONITOR_ID_PATTERN.test(value)
    ? value
    : undefined;
}

export function sanitizeTargetToken(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  const normalized = value.trim().toLowerCase();
  return TARGET_TOKEN_PATTERN.test(normalized) ? normalized : undefined;
}

export function readMonitorId(node: unknown): string | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  return sanitizeMonitorId(readAttribute(node, 'data-spectro-monitor-id'));
}

export function createMonitoredTarget(node: unknown): MonitoredTarget | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const monitorId = readMonitorId(node);
  if (monitorId === undefined) return undefined;
  const tag = sanitizeTargetToken(readProperty(node, 'tagName'));
  const role = sanitizeTargetToken(readAttribute(node, 'role'));
  return {
    monitorId,
    ...(tag === undefined ? {} : { tag }),
    ...(role === undefined ? {} : { role }),
  };
}

function composedPath(event: object): unknown[] {
  try {
    const method = Reflect.get(event, 'composedPath');
    if (typeof method !== 'function') return [];
    const path: unknown = Reflect.apply(method, event, []);
    return Array.isArray(path) ? path.slice(0, MAX_TARGET_DEPTH) : [];
  } catch {
    return [];
  }
}

export function findMonitoredTarget(event: unknown): MonitoredTarget | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  for (const node of composedPath(event)) {
    const target = createMonitoredTarget(node);
    if (target !== undefined) return target;
  }

  let node: unknown = readProperty(event, 'target');
  const visited = new Set<object>();
  for (let depth = 0; depth < MAX_TARGET_DEPTH; depth += 1) {
    if (typeof node !== 'object' || node === null || visited.has(node)) return undefined;
    visited.add(node);
    const target = createMonitoredTarget(node);
    if (target !== undefined) return target;
    node = readProperty(node, 'parentElement');
  }
  return undefined;
}
