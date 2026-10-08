import { protocolSchemas } from '@spectro/protocol';

export { schemaContracts, parseSchemaSearch, SCHEMA_VIEWS } from './schema-navigation.js';
export type { SchemaView, SchemaContractId, SchemaSearch } from './schema-navigation.js';

export type SchemaObject = Readonly<Record<string, unknown>>;
export type SchemaNode = SchemaObject | boolean;

export function isSchemaObject(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSchemaNode(value: unknown): value is SchemaNode {
  return typeof value === 'boolean' || isSchemaObject(value);
}

/** Resolve only bundled identifiers. No external access or inherited-property traversal. */
export function resolveSchemaReference(
  reference: string,
  documentId: string,
  documents: readonly SchemaObject[] = Object.values(protocolSchemas),
): { node: SchemaNode; documentId: string } | undefined {
  try {
    const url = new URL(reference, documentId);
    const pointer = decodeURIComponent(url.hash.slice(1));
    url.hash = '';
    const id = url.href;
    let value: unknown = documents.find((document) => document.$id === id);
    if (value === undefined || (pointer !== '' && !pointer.startsWith('/'))) return undefined;
    for (const segment of pointer === '' ? [] : pointer.slice(1).split('/')) {
      if (/~(?:[^01]|$)/.test(segment)) return undefined;
      const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
      if (Array.isArray(value)) {
        if (!/^(0|[1-9]\d*)$/.test(key)) return undefined;
        value = value[Number(key)];
      } else if (isSchemaObject(value) && Object.hasOwn(value, key)) {
        value = value[key];
      } else return undefined;
    }
    return isSchemaNode(value) ? { node: value, documentId: id } : undefined;
  } catch {
    return undefined;
  }
}

export interface SchemaField {
  readonly name: string;
  readonly presence: 'Required' | 'Optional' | 'Item' | 'Rule';
  readonly node: SchemaNode;
  readonly documentId: string;
}

export function schemaFields(node: SchemaNode, documentId: string): SchemaField[] {
  if (typeof node === 'boolean') return [];
  const required = Array.isArray(node.required) ? node.required : [];
  const fields: SchemaField[] = isSchemaObject(node.properties)
    ? Object.entries(node.properties).flatMap(([name, value]) =>
        isSchemaNode(value)
          ? [
              {
                name,
                node: value,
                documentId,
                presence: required.includes(name) ? ('Required' as const) : ('Optional' as const),
              },
            ]
          : [],
      )
    : [];
  if (isSchemaNode(node.items))
    fields.push({ name: '[]', node: node.items, documentId, presence: 'Item' });
  if (Array.isArray(node.prefixItems))
    node.prefixItems.forEach((item, index) => {
      if (isSchemaNode(item))
        fields.push({ name: `[${index}]`, node: item, documentId, presence: 'Item' });
    });
  if (isSchemaObject(node.additionalProperties))
    fields.push({ name: '[key]', node: node.additionalProperties, documentId, presence: 'Rule' });
  if (isSchemaNode(node.propertyNames))
    fields.push({ name: 'Property names', node: node.propertyNames, documentId, presence: 'Rule' });
  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    const alternatives = node[keyword];
    if (Array.isArray(alternatives))
      alternatives.forEach((item, index) => {
        if (isSchemaNode(item))
          fields.push({
            name: `${keyword} ${index + 1}`,
            node: item,
            documentId,
            presence: 'Rule',
          });
      });
  }
  for (const keyword of ['if', 'then', 'else', 'not'] as const) {
    if (isSchemaNode(node[keyword]))
      fields.push({ name: keyword, node: node[keyword], documentId, presence: 'Rule' });
  }
  return fields;
}

export function schemaType(node: SchemaNode): string {
  if (typeof node === 'boolean') return node ? 'Any value' : 'No value';
  if (typeof node.type === 'string') return node.type;
  if (Array.isArray(node.type)) return node.type.join(' | ');
  if (Object.hasOwn(node, 'const')) return 'constant';
  if (node.oneOf !== undefined) return 'one of';
  if (node.anyOf !== undefined) return 'any of';
  if (node.if !== undefined || node.allOf !== undefined) return 'conditional';
  if (typeof node.$ref === 'string') return 'reference';
  return 'schema';
}

export function schemaConstraints(node: SchemaNode): string[] {
  if (typeof node === 'boolean') return [node ? 'All values permitted' : 'No values permitted'];
  const constraints: string[] = [];
  if (node.type === 'boolean') constraints.push('true or false');
  if (Object.hasOwn(node, 'const')) constraints.push(`Exactly ${JSON.stringify(node.const)}`);
  if (Array.isArray(node.enum))
    constraints.push(`One of: ${node.enum.map((value) => JSON.stringify(value)).join(' / ')}`);
  if (typeof node.minLength === 'number' && typeof node.maxLength === 'number')
    constraints.push(`${node.minLength} – ${node.maxLength.toLocaleString('en-US')} characters`);
  else {
    if (typeof node.minLength === 'number')
      constraints.push(`Min ${node.minLength} character${node.minLength === 1 ? '' : 's'}`);
    if (typeof node.maxLength === 'number')
      constraints.push(`Max ${node.maxLength.toLocaleString('en-US')} characters`);
  }
  if (typeof node.minimum === 'number') constraints.push(`Minimum ${node.minimum}`);
  if (typeof node.maximum === 'number') constraints.push(`Maximum ${node.maximum}`);
  if (typeof node.exclusiveMinimum === 'number')
    constraints.push(`Greater than ${node.exclusiveMinimum}`);
  if (typeof node.exclusiveMaximum === 'number')
    constraints.push(`Less than ${node.exclusiveMaximum}`);
  if (typeof node.minItems === 'number') constraints.push(`Min ${node.minItems} items`);
  if (typeof node.maxItems === 'number') constraints.push(`Max ${node.maxItems} items`);
  if (typeof node.maxProperties === 'number')
    constraints.push(`Max ${node.maxProperties} properties`);
  if (typeof node.pattern === 'string') constraints.push(`Pattern: ${node.pattern}`);
  if (typeof node.format === 'string') constraints.push(`Format: ${node.format}`);
  if (node.additionalProperties === false) constraints.push('No additional properties');
  if (node.additionalProperties === true) constraints.push('Additional properties permitted');
  if (typeof node.description === 'string') constraints.push(node.description);
  if (Array.isArray(node.oneOf)) constraints.push('Exactly one alternative must match');
  if (Array.isArray(node.anyOf)) constraints.push('At least one alternative must match');
  if (Array.isArray(node.allOf)) constraints.push('All rules must match');
  if (node.if !== undefined)
    constraints.push('When if matches, then applies; otherwise else applies');
  return constraints;
}

export interface SchemaRow {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly presence: SchemaField['presence'];
  readonly type: string;
  readonly constraints: readonly string[];
  readonly expandable: boolean;
  readonly reference?: string;
  readonly note?: string;
}

export function buildSchemaRows(
  root: SchemaNode,
  documentId: string,
  expanded: ReadonlySet<string>,
): { rows: SchemaRow[]; limited: boolean } {
  const rows: SchemaRow[] = [];
  let limited = false;
  function walk(
    field: SchemaField,
    parent: string,
    depth: number,
    ancestors: ReadonlySet<string>,
  ): void {
    if (rows.length >= 200) {
      limited = true;
      return;
    }
    const id = `${parent}/${field.name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    let current = field.node;
    let currentDocument = field.documentId;
    const constraints = schemaConstraints(current);
    const children = schemaFields(current, currentDocument);
    const references = new Set(ancestors);
    let reference: string | undefined;
    let note: string | undefined;
    for (let count = 0; isSchemaObject(current) && typeof current.$ref === 'string'; count += 1) {
      reference = current.$ref;
      const target = resolveSchemaReference(reference, currentDocument);
      const identity = target ? new URL(reference, currentDocument).href : reference;
      if (!target) {
        note = 'Unresolved local reference. Inspect JSON Schema.';
        break;
      }
      if (references.has(identity)) {
        note = 'Recursive reference. Inspect JSON Schema for the full definition.';
        break;
      }
      if (count >= 16) {
        note = 'Reference expansion limit reached. Inspect JSON Schema.';
        break;
      }
      references.add(identity);
      current = target.node;
      currentDocument = target.documentId;
      constraints.push(...schemaConstraints(current));
      children.push(...schemaFields(current, currentDocument));
    }
    if (depth >= 12 && children.length > 0)
      note = 'Expansion depth limit reached. Inspect JSON Schema.';
    const expandable = !note && children.length > 0;
    rows.push({
      id,
      name: field.name,
      depth,
      presence: field.presence,
      type: schemaType(current),
      constraints: [...new Set(constraints)],
      expandable,
      ...(reference ? { reference } : {}),
      ...(note ? { note } : {}),
    });
    if (expandable && expanded.has(id)) {
      for (const child of children) walk(child, id, depth + 1, references);
    }
  }
  const fields = schemaFields(root, documentId);
  if (documentId === protocolSchemas.error.$id) {
    const order = ['mechanism', 'message', 'handled', 'name', 'stack', 'fingerprint', 'source'];
    fields.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  }
  for (const field of fields) walk(field, '', 0, new Set());
  return { rows, limited };
}
