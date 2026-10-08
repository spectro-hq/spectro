import { protocolSchemas } from '@spectro/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildSchemaRows,
  parseSchemaSearch,
  resolveSchemaReference,
  schemaConstraints,
  schemaFields,
  schemaType,
} from './schema-catalogue.js';

const commonId = String(protocolSchemas.common.$id);
const errorId = String(protocolSchemas.error.$id);

describe('protocol catalogue', () => {
  it('resolves cross-document and local definition references without network access', () => {
    expect(resolveSchemaReference('error.schema.json', commonId)?.node).toBe(protocolSchemas.error);
    const target = resolveSchemaReference('#/$defs/eventContext', commonId);
    expect(target?.node).toMatchObject({ required: ['sdk', 'project', 'environment'] });
    expect(target?.documentId).toBe(commonId);
  });
  it('honors JSON Pointer escaping, URI encoding and array indexes', () => {
    const document = {
      $id: commonId,
      $defs: { 'a/b~c': { type: 'string' }, 'white space': false },
      anyOf: [true],
    };
    expect(resolveSchemaReference('#/$defs/a~1b~0c', commonId, [document])?.node).toEqual({
      type: 'string',
    });
    expect(resolveSchemaReference('#/$defs/white%20space', commonId, [document])?.node).toBe(false);
    expect(resolveSchemaReference('#/anyOf/0', commonId, [document])?.node).toBe(true);
    expect(resolveSchemaReference('#/anyOf/00', commonId, [document])).toBeUndefined();
  });
  it.each([
    'https://unbundled.example/schema.json',
    '#/$defs/missing',
    '#/constructor',
    '#/__proto__',
    '#/toString',
    '#/bad~2escape',
    '#/%FF',
    '#anchor',
    '#/$id',
  ])('fails safely on %s', (reference) => {
    expect(resolveSchemaReference(reference, commonId)).toBeUndefined();
  });
  it('preserves selected navigation scope but drops telemetry-specific filters', () => {
    expect(
      parseSchemaSearch({
        organization: 'org_test',
        project: 'prj_test',
        environment: 'development',
        range: '6h',
        source: 'illustrative',
        contract: 'network',
        view: 'schema',
        event: 'private-event',
        name: 'secret_filter',
      }),
    ).toEqual({
      organization: 'org_test',
      project: 'prj_test',
      environment: 'development',
      range: '6h',
      source: 'illustrative',
      contract: 'network',
      view: 'schema',
    });
    expect(parseSchemaSearch({ contract: 'constructor', view: 'unknown' })).toMatchObject({
      contract: 'error',
      view: 'fields',
    });
  });
  it('derives local requiredness, array-item semantics and real error constraints', () => {
    const { rows } = buildSchemaRows(
      protocolSchemas.error,
      errorId,
      new Set(['/stack', '/source']),
    );
    expect(rows.find((row) => row.id === '/mechanism')?.presence).toBe('Required');
    expect(rows.find((row) => row.id === '/source/line')).toMatchObject({
      presence: 'Optional',
      type: 'integer',
      constraints: ['Minimum 0'],
    });
    expect(rows.find((row) => row.id === '/source/url')?.constraints).toEqual([
      'Max 2,048 characters',
    ]);
    expect(rows.find((row) => row.id === '/stack/[]')?.presence).toBe('Item');
  });
  it('keeps requiredness inside a referenced optional parent separate', () => {
    const context = resolveSchemaReference('#/$defs/eventContext', commonId);
    if (!context) throw new Error('Missing context schema');
    const { rows } = buildSchemaRows(context.node, commonId, new Set(['/session', '/sdk']));
    expect(rows.find((row) => row.id === '/session')?.presence).toBe('Optional');
    expect(rows.find((row) => row.id === '/session/id')?.presence).toBe('Required');
    expect(rows.find((row) => row.id === '/sdk/name')?.presence).toBe('Required');
  });
  it('retains conditional branches, alternatives and referenced sibling constraints', () => {
    const eventRows = buildSchemaRows(
      protocolSchemas.event,
      String(protocolSchemas.event.$id),
      new Set(['/allOf 1']),
    ).rows;
    expect(eventRows.find((row) => row.id === '/allOf 1')?.presence).toBe('Rule');
    expect(eventRows.some((row) => row.id === '/allOf 1/if')).toBe(true);
    expect(eventRows.some((row) => row.id === '/allOf 1/then')).toBe(true);
    const { rows } = buildSchemaRows(
      {
        properties: {
          value: {
            $ref: 'common.schema.json#/$defs/jsonValue',
            description: 'A bounded custom value',
          },
        },
      },
      commonId,
      new Set(['/value']),
    );
    expect(rows[0]?.constraints).toContain('A bounded custom value');
    expect(rows[0]?.constraints).toContain('Exactly one alternative must match');
    expect(rows.filter((row) => row.presence === 'Rule')).toHaveLength(6);
  });
  it('bounds recursive references and keeps the full raw contract available', () => {
    const root = resolveSchemaReference('#/$defs/jsonObject', commonId);
    if (!root) throw new Error('Missing recursive JSON schema');
    const expanded = new Set(['/[key]', '/[key]/oneOf 5', '/[key]/oneOf 5/[]']);
    const { rows } = buildSchemaRows(root.node, commonId, expanded);
    expect(rows.find((row) => row.id === '/[key]/oneOf 5/[]')).toMatchObject({
      expandable: false,
      note: expect.stringContaining('Recursive reference'),
    });
    expect(rows).toHaveLength(9);
  });
  it('bounds deeply nested and very wide structures without hiding the reason', () => {
    const root = {
      properties: Object.fromEntries(
        Array.from({ length: 250 }, (_, i) => [`field_${i}`, { type: 'string' }]),
      ),
    };
    expect(buildSchemaRows(root, commonId, new Set())).toMatchObject({
      limited: true,
      rows: expect.any(Array),
    });
    expect(buildSchemaRows(root, commonId, new Set()).rows).toHaveLength(200);
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 20; i++) deep = { properties: { nested: deep } };
    const { rows } = buildSchemaRows(
      deep,
      commonId,
      new Set(Array.from({ length: 20 }, (_, i) => '/nested'.repeat(i + 1))),
    );
    expect(rows.at(-1)?.note).toContain('Expansion depth limit');
    expect(rows).toHaveLength(13);
  });
  it('explains unresolved references, booleans, array tuples and numeric bounds', () => {
    expect(
      buildSchemaRows(
        { properties: { value: { $ref: 'unknown.schema.json' } } },
        commonId,
        new Set(),
      ).rows[0]?.note,
    ).toContain('Unresolved local reference');
    expect(schemaType(false)).toBe('No value');
    expect(schemaConstraints(true)).toEqual(['All values permitted']);
    expect(
      schemaFields({ prefixItems: [true, false], propertyNames: { maxLength: 5 } }, commonId).map(
        (field) => field.presence,
      ),
    ).toEqual(['Item', 'Item', 'Rule']);
    expect(
      schemaConstraints({
        type: 'number',
        minimum: 0,
        maximum: 10,
        exclusiveMinimum: 0,
        exclusiveMaximum: 10,
      }),
    ).toEqual(['Minimum 0', 'Maximum 10', 'Greater than 0', 'Less than 10']);
  });
});
