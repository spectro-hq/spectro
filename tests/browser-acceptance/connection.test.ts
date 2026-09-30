import { describe, expect, it } from 'vitest';

import { hostedConsoleUrl, ingestionFailureMessage, parseHostedConnection } from './connection.js';

const apiKey = `spk_${'a'.repeat(43)}`;
describe('hosted browser acceptance connection', () => {
  it('validates and trims the exact write-key scope', () => {
    expect(
      parseHostedConnection({
        projectId: ' prj_local ',
        environment: ' development ',
        apiKey: ` ${apiKey} `,
      }),
    ).toEqual({ projectId: 'prj_local', environment: 'development', apiKey });
  });
  it.each([
    { projectId: '../../secrets', environment: 'development', apiKey },
    { projectId: 'prj_local', environment: '', apiKey },
    { projectId: 'prj_local', environment: 'x'.repeat(65), apiKey },
    { projectId: 'prj_local', environment: 'development', apiKey: 'private-sentinel-key' },
  ])('rejects malformed fields without echoing credentials', (input) => {
    expect(() => parseHostedConnection(input)).toThrow(/Enter|Paste/);
    const message = (() => {
      try {
        parseHostedConnection(input);
        return '';
      } catch (error) {
        return String(error);
      }
    })();
    expect(message).not.toContain(input.apiKey);
  });
  it('links to live evidence on the fixed local Console without credentials', () => {
    const connection = parseHostedConnection({
      projectId: 'prj_local',
      environment: 'development',
      apiKey,
    });
    const url = new URL(hostedConsoleUrl(connection));
    expect(url.origin).toBe('https://localhost:5188');
    expect(url.searchParams.get('source')).toBe('live');
    expect(url.searchParams.get('project')).toBe(connection.projectId);
    expect(url.searchParams.get('environment')).toBe(connection.environment);
    expect(url.href).not.toContain(apiKey);
  });
  it('uses bounded recovery messages rather than reflecting arbitrary server text', () => {
    expect(ingestionFailureMessage(401)).toContain('invalid or revoked');
    expect(ingestionFailureMessage(403, 'origin_denied')).toContain('page origin');
    expect(ingestionFailureMessage(403, 'project_scope_mismatch')).toContain(
      'project or environment',
    );
    expect(ingestionFailureMessage(503)).toContain('temporarily unavailable');
    expect(ingestionFailureMessage(400, 'private-sentinel-key')).not.toContain(
      'private-sentinel-key',
    );
  });
});
