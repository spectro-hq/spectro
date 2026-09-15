import { timingSafeEqual } from 'node:crypto';

import type { ProjectAuthorizer } from './events.js';

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) {
    return undefined;
  }

  const token = authorization.slice('Bearer '.length);
  return token.length > 0 ? token : undefined;
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export class StaticProjectAuthorizer implements ProjectAuthorizer {
  readonly #projectId: string;
  readonly #token: string;

  constructor(input: { readonly projectId: string; readonly token: string }) {
    this.#projectId = input.projectId;
    this.#token = input.token;
  }

  async authorize(input: {
    readonly authorization?: string;
    readonly projectId: string;
  }): Promise<boolean> {
    const token = bearerToken(input.authorization);
    return (
      input.projectId === this.#projectId && token !== undefined && secretsEqual(token, this.#token)
    );
  }
}

export function createLocalProjectAuthorizer(environment: NodeJS.ProcessEnv): ProjectAuthorizer {
  const projectId = environment.SPECTRO_API_LOCAL_PROJECT_ID;
  const token = environment.SPECTRO_API_LOCAL_TOKEN;

  if (!projectId || !token) {
    return { authorize: async () => false };
  }

  return new StaticProjectAuthorizer({ projectId, token });
}
