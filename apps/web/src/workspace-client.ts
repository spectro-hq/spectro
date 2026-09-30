import { z } from 'zod';

import { apiReadHeaders, fetchConsoleSession } from './auth-client.js';

const organizationSchema = z.object({
  id: z.string().regex(/^org_[A-Za-z0-9_-]{1,120}$/),
  name: z.string(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

const projectSchema = z.object({
  id: z.string().regex(/^prj_[A-Za-z0-9_-]{1,120}$/),
  organizationId: z.string().regex(/^org_[A-Za-z0-9_-]{1,120}$/),
  name: z.string(),
  environments: z.array(z.string()),
});

const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), nextCursor: z.string().optional() });

export type OrganizationSummary = z.infer<typeof organizationSchema>;
export type ProjectSummary = z.infer<typeof projectSchema>;

export class WorkspaceRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'WorkspaceRequestError';
    this.status = status;
  }
}

async function readWorkspaceResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    let message = `Workspace request failed with status ${response.status}.`;
    const body: unknown = await response.json().catch(() => undefined);
    const result = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    if (result.success) message = result.data.error.message;
    throw new WorkspaceRequestError(message, response.status);
  }
  return schema.parse(await response.json());
}

export async function fetchOrganizations(signal?: AbortSignal): Promise<OrganizationSummary[]> {
  const response = await fetch('/v1/organizations?limit=100', {
    credentials: 'same-origin',
    headers: apiReadHeaders(''),
    ...(signal === undefined ? {} : { signal }),
  });
  const page = await readWorkspaceResponse(response, pageSchema(organizationSchema));
  return page.data;
}

export async function fetchOrganizationProjects(
  organizationId: string,
  signal?: AbortSignal,
): Promise<ProjectSummary[]> {
  const response = await fetch(
    `/v1/organizations/${encodeURIComponent(organizationId)}/projects?limit=100`,
    {
      credentials: 'same-origin',
      headers: apiReadHeaders(''),
      ...(signal === undefined ? {} : { signal }),
    },
  );
  const page = await readWorkspaceResponse(response, pageSchema(projectSchema));
  return page.data;
}

async function csrfHeaders(): Promise<Headers> {
  const session = await fetchConsoleSession();
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('x-csrf-token', session.csrfToken);
  return headers;
}

export async function createOrganization(input: { name: string }): Promise<OrganizationSummary> {
  const response = await fetch('/v1/organizations', {
    method: 'POST',
    credentials: 'same-origin',
    headers: await csrfHeaders(),
    body: JSON.stringify(input),
  });
  return readWorkspaceResponse(response, organizationSchema);
}

export async function createProject(input: {
  organizationId: string;
  name: string;
  environments: string[];
}): Promise<ProjectSummary> {
  const response = await fetch(
    `/v1/organizations/${encodeURIComponent(input.organizationId)}/projects`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: await csrfHeaders(),
      body: JSON.stringify({ name: input.name, environments: input.environments }),
    },
  );
  return readWorkspaceResponse(response, projectSchema);
}
