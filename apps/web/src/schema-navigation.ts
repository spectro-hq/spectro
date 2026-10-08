import type { ProtocolSchemaName } from '@spectro/protocol';
import { parseExplorerSearch, type ExplorerSearch } from './event-query.js';

export const SCHEMA_VIEWS = ['fields', 'example', 'schema'] as const;
export type SchemaView = (typeof SCHEMA_VIEWS)[number];

export const schemaContracts = [
  {
    id: 'envelope',
    label: 'Envelope',
    group: 'Common contracts',
    document: 'envelope',
    description: 'Transport envelope and event items.',
  },
  {
    id: 'event',
    label: 'Event',
    group: 'Common contracts',
    document: 'event',
    description: 'Common event fields and type-specific payload contracts.',
  },
  {
    id: 'context',
    label: 'Context',
    group: 'Common contracts',
    document: 'common',
    fragment: '#/$defs/eventContext',
    description: 'Required SDK, project and environment with optional context.',
  },
  {
    id: 'session',
    label: 'Session',
    group: 'Payloads',
    document: 'session',
    description: 'Session lifecycle action and optional duration.',
  },
  {
    id: 'page',
    label: 'Page',
    group: 'Payloads',
    document: 'page',
    description: 'Page lifecycle action and optional navigation paths.',
  },
  {
    id: 'error',
    label: 'Error',
    group: 'Payloads',
    document: 'error',
    description: 'Required fields and optional error context.',
  },
  {
    id: 'performance',
    label: 'Performance',
    group: 'Payloads',
    document: 'performance',
    description: 'Metric values, units and optional ratings and attribution.',
  },
  {
    id: 'network',
    label: 'Network',
    group: 'Payloads',
    document: 'network',
    description: 'Sanitized request, timing, initiator and success state.',
  },
  {
    id: 'interaction',
    label: 'Interaction',
    group: 'Payloads',
    document: 'interaction',
    description: 'Optional target metadata and opt-in coordinates.',
  },
  {
    id: 'custom',
    label: 'Custom',
    group: 'Payloads',
    document: 'custom',
    description: 'Bounded JSON properties for custom events.',
  },
] as const satisfies readonly {
  id: string;
  label: string;
  group: string;
  document: ProtocolSchemaName;
  fragment?: string;
  description: string;
}[];

export type SchemaContractId = (typeof schemaContracts)[number]['id'];

export type SchemaSearch = Pick<
  ExplorerSearch,
  'organization' | 'project' | 'environment' | 'range' | 'source'
> & { contract: SchemaContractId; view: SchemaView };

export function parseSchemaSearch(input: Record<string, unknown>): SchemaSearch {
  const { organization, project, environment, range, source } = parseExplorerSearch(input);
  const contract = schemaContracts.find(({ id }) => id === input.contract)?.id ?? 'error';
  const view = SCHEMA_VIEWS.find((value) => value === input.view) ?? 'fields';
  return { organization, project, environment, range, source, contract, view };
}
