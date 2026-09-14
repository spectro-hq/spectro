const MAX_NETWORK_URL_LENGTH = 2_048;
const MAX_NETWORK_METHOD_LENGTH = 16;
const NETWORK_METHOD_PATTERN = /^[A-Z]+$/u;

export function sanitizeNetworkMethod(method: string): string | undefined {
  const normalized = method.trim().toUpperCase();
  return normalized.length <= MAX_NETWORK_METHOD_LENGTH && NETWORK_METHOD_PATTERN.test(normalized)
    ? normalized
    : undefined;
}

export function sanitizeNetworkUrl(rawUrl: string, baseUrl?: string): string | undefined {
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = baseUrl === undefined ? new URL(trimmed) : new URL(trimmed, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return `${parsed.origin}${parsed.pathname}`.slice(0, MAX_NETWORK_URL_LENGTH);
  } catch {
    return undefined;
  }
}
