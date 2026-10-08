import { protocolSchemas } from '@spectro/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PayloadViewer } from './payload-viewer.js';
import { schemaFieldLabel, SchemaFields, SchemaReference } from './schema-reference.js';
import { parseSchemaSearch } from './schema-navigation.js';

const route = vi.hoisted(() => ({ contract: 'error', view: 'fields' }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () =>
    parseSchemaSearch({
      ...route,
      project: 'prj_test',
      environment: 'development',
      source: 'illustrative',
    }),
  useNavigate: () => vi.fn<(options: unknown) => Promise<void>>(),
}));
vi.mock('./console-shared.js', () => ({ ThemeToggle: () => null }));

describe('schema reference integration', () => {
  it('renders original protocol constraints with expandable nested fields', () => {
    const markup = renderToStaticMarkup(
      <SchemaFields
        node={protocolSchemas.error}
        documentId={String(protocolSchemas.error.$id)}
        contractId="error"
      />,
    );
    expect(markup).toContain('aria-label="Collapse source"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('Minimum 0');
    expect(markup).toContain('Array item');
    expect(markup).not.toContain('Valid URL');
    expect(markup).not.toContain('Positive integer');
    expect(markup).toContain('No additional properties');
    expect(markup).toContain(
      'padding-inline-start:16px"><span class="schema-disclosure-spacer" aria-hidden="true"></span><code>url</code>',
    );
    expect(markup).not.toContain('aria-label="Expand source.url"');
  });
  it('keeps full JSON Pointer paths when visual indentation is capped', () => {
    expect(schemaFieldLabel({ id: '/a/b/c/d/name', name: 'name', depth: 4 })).toBe('name');
    expect(schemaFieldLabel({ id: '/a/b/c/d/e/a~1b', name: 'a/b', depth: 5 })).toBe(
      '/a/b/c/d/e/a~1b',
    );
  });
  it('renders global reference chrome and scoped native links without telemetry filters', () => {
    route.contract = 'error';
    route.view = 'fields';
    const markup = renderToStaticMarkup(<SchemaReference />);
    expect(markup).toContain('Protocol reference');
    expect(markup).toContain('aria-label="Protocol contracts"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('Reference for this Console build');
    expect(markup).toContain('contract=network');
    expect(markup).toContain('project=prj_test');
    expect(markup).not.toContain('Local API connected');
    expect(markup).not.toContain('Time range');
    expect(markup).not.toContain('Refresh');
  });
  it('shows synthetic payload examples and original raw documents, not live data', () => {
    route.contract = 'network';
    route.view = 'example';
    const example = renderToStaticMarkup(<SchemaReference />);
    expect(example).toContain('Synthetic example');
    expect(example).toContain('https://api.example/orders');
    expect(example).toContain('Authorization, cookies');
    expect(example).toContain('Runtime admission');
    expect(example).not.toContain('Payload format');
    route.contract = 'context';
    route.view = 'schema';
    const raw = renderToStaticMarkup(<SchemaReference />);
    expect(raw).toContain('Context is defined at #/$defs/eventContext');
    expect(raw).toContain('eventContext');
    expect(raw).toContain('$schema');
    expect(raw).toContain('Copy');
  });
  it('preserves the existing event viewer format control by default', () => {
    const markup = renderToStaticMarkup(<PayloadViewer value={{ safe: true }} />);
    expect(markup).toContain('Event payload');
    expect(markup).toContain('Payload format');
    expect(markup).toContain('YAML');
  });
});
