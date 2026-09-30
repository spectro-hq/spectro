export interface HostedConnection {
  readonly projectId: string;
  readonly environment: string;
  readonly apiKey: string;
}

export function parseHostedConnection(input: HostedConnection): HostedConnection {
  const projectId = input.projectId.trim();
  const environment = input.environment.trim();
  const apiKey = input.apiKey.trim();
  if (!/^prj_[A-Za-z0-9_-]{1,120}$/.test(projectId)) {
    throw new Error('Enter the project ID shown in your Console URL.');
  }
  if (!environment || environment.length > 64) {
    throw new Error('Enter the exact environment associated with this Browser Key.');
  }
  if (!/^spk_[A-Za-z0-9_-]{43}$/.test(apiKey)) {
    throw new Error('Paste the complete Browser Key saved when you created it.');
  }
  return { projectId, environment, apiKey };
}

export function hostedConsoleUrl(
  connection: Pick<HostedConnection, 'projectId' | 'environment'>,
): string {
  const url = new URL('https://localhost:5188/');
  url.search = new URLSearchParams({
    project: connection.projectId,
    environment: connection.environment,
    range: '30m',
    source: 'live',
  }).toString();
  return url.href;
}

export function ingestionFailureMessage(status: number, code?: string): string {
  if (status === 401)
    return 'The Browser Key is invalid or revoked. Paste an active key and reconnect.';
  if (code === 'origin_denied') {
    return 'This page origin is not allowed by the Browser Key. Use an allowed origin or create a separate test key.';
  }
  if (code === 'project_scope_mismatch') {
    return 'The project or environment does not match this Browser Key. Correct the connection and reconnect.';
  }
  if (status === 503)
    return 'Ingestion is temporarily unavailable. Check the local services, then retry.';
  return `Ingestion rejected the request (HTTP ${status}). Check the local service configuration.`;
}
