import { z } from 'zod';

import { apiReadHeaders, fetchConsoleSession } from './auth-client.js';

const keySummarySchema = z.object({
  id: z.string().regex(/^key_[A-Za-z0-9_-]{1,120}$/),
  environment: z.string(),
  label: z.string(),
  keyHint: z.string(),
  allowedOrigins: z.array(z.string()),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

const keyListSchema = z.object({
  data: z.array(keySummarySchema),
  ingestionEndpoint: z.string().url(),
});

const createdKeySchema = z.object({
  key: z.string().regex(/^spk_[A-Za-z0-9_-]{43}$/),
  metadata: keySummarySchema,
});

export type ProjectWriteKey = z.infer<typeof keySummarySchema>;
export type ProjectWriteKeyList = z.infer<typeof keyListSchema>;
export type CreatedProjectWriteKey = z.infer<typeof createdKeySchema>;

export class ProjectWriteKeyRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProjectWriteKeyRequestError';
    this.status = status;
  }
}

async function errorFromResponse(response: Response): Promise<ProjectWriteKeyRequestError> {
  let message = `Project key request failed with status ${response.status}.`;
  const body: unknown = await response.json().catch(() => undefined);
  const result = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
  if (result.success) message = result.data.error.message;
  return new ProjectWriteKeyRequestError(message, response.status);
}

async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return schema.parse(await response.json());
}

function keyPath(projectId: string, environment: string): string {
  return `/v1/projects/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(environment)}/write-keys`;
}

export async function fetchProjectWriteKeys(input: {
  readonly projectId: string;
  readonly environment: string;
  readonly signal?: AbortSignal;
}): Promise<ProjectWriteKeyList> {
  const response = await fetch(keyPath(input.projectId, input.environment), {
    credentials: 'same-origin',
    headers: apiReadHeaders(''),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return parseResponse(response, keyListSchema);
}

async function csrfHeaders(): Promise<Headers> {
  const session = await fetchConsoleSession();
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-csrf-token', session.csrfToken);
  return headers;
}

export async function createProjectWriteKey(input: {
  readonly projectId: string;
  readonly environment: string;
  readonly label: string;
  readonly allowedOrigins: readonly string[];
}): Promise<CreatedProjectWriteKey> {
  const response = await fetch(keyPath(input.projectId, input.environment), {
    method: 'POST',
    credentials: 'same-origin',
    headers: await csrfHeaders(),
    body: JSON.stringify({
      environment: input.environment,
      label: input.label,
      allowedOrigins: input.allowedOrigins,
    }),
  });
  return parseResponse(response, createdKeySchema);
}

export async function revokeProjectWriteKey(input: {
  readonly projectId: string;
  readonly environment: string;
  readonly keyId: string;
}): Promise<void> {
  const response = await fetch(
    `${keyPath(input.projectId, input.environment)}/${encodeURIComponent(input.keyId)}`,
    {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: await csrfHeaders(),
    },
  );
  if (!response.ok) throw await errorFromResponse(response);
}
