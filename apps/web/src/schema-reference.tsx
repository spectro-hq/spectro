import {
  ENVELOPE_VERSION,
  EVENT_VERSION,
  MAX_ENVELOPE_BYTES,
  MAX_EVENT_BYTES,
  MAX_JSON_DEPTH,
  MAX_ENVELOPE_STRUCTURE_DEPTH,
  protocolSchemas,
} from '@spectro/protocol';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo, useState, type ReactElement } from 'react';
import { writeClipboard } from './clipboard.js';
import { ConsoleShell } from './console-shell.js';
import { PayloadViewer } from './payload-viewer.js';
import { SpectroIcon } from './spectro-icons.js';
import { schemaExample, schemaGuidance } from './schema-examples.js';
import {
  buildSchemaRows,
  resolveSchemaReference,
  schemaContracts,
  schemaConstraints,
  type SchemaNode,
  type SchemaRow,
  type SchemaView,
} from './schema-catalogue.js';

const viewLabels: Record<SchemaView, string> = {
  fields: 'Fields',
  example: 'Example',
  schema: 'JSON Schema',
};
const errorFieldDescriptions: Readonly<Record<string, string>> = {
  '/mechanism': 'The mechanism that created the error.',
  '/message': 'Human readable error message.',
  '/handled': 'Whether the error was handled by the application.',
  '/name': 'Error class or name, e.g. “TypeError”.',
  '/stack': 'Array of stack frames.',
  '/fingerprint': 'Custom fingerprint for grouping similar errors.',
  '/source': 'Source information about where the error occurred.',
};

export function schemaFieldLabel(row: Pick<SchemaRow, 'id' | 'name' | 'depth'>): string {
  return row.depth > 4 ? row.id : row.name;
}

export function SchemaReference(): ReactElement {
  const search = useSearch({ from: '/schemas' });
  const navigate = useNavigate({ from: '/schemas' });
  const contract = schemaContracts.find(({ id }) => id === search.contract) ?? schemaContracts[5];
  const document = protocolSchemas[contract.document];
  const documentId = String(document.$id);
  const fragment = 'fragment' in contract ? contract.fragment : '';
  const target = resolveSchemaReference(fragment, documentId);
  const title = contract.group === 'Payloads' ? `${contract.label} payload` : contract.label;
  return (
    <ConsoleShell title="Schemas" search={search} reference>
      <main className="schema-workspace">
        <header className="schema-page-heading">
          <div>
            <h1>Schemas</h1>
            <p>Supported event contracts</p>
          </div>
          <span>
            Event v{EVENT_VERSION} · Envelope v{ENVELOPE_VERSION}
          </span>
        </header>
        <section className="schema-workbench" aria-label="Protocol reference">
          <nav className="schema-index" aria-label="Protocol contracts">
            {(['Common contracts', 'Payloads'] as const).map((group) => (
              <section key={group} aria-label={group}>
                <h2>{group}</h2>
                {schemaContracts
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <Link
                      key={item.id}
                      to="/schemas"
                      search={{ ...search, contract: item.id }}
                      aria-current={item.id === search.contract ? 'page' : undefined}
                    >
                      <SpectroIcon name="page" size={16} />
                      <span>{item.label}</span>
                    </Link>
                  ))}
              </section>
            ))}
          </nav>
          <div className="schema-reading-pane">
            <header className="schema-contract-heading">
              <h2>{title}</h2>
              <p>{contract.description}</p>
              <p className="schema-build-note">
                Reference for this Console build; ingestion versions may differ.
              </p>
            </header>
            <div className="detail-tabs schema-tabs" role="tablist" aria-label="Contract view">
              {(['fields', 'example', 'schema'] as const).map((view) => (
                <button
                  key={view}
                  id={`schema-tab-${view}`}
                  type="button"
                  role="tab"
                  aria-selected={search.view === view}
                  aria-controls="schema-tab-panel"
                  tabIndex={search.view === view ? 0 : -1}
                  onClick={() => void navigate({ search: (previous) => ({ ...previous, view }) })}
                  onKeyDown={(event) => {
                    const views = ['fields', 'example', 'schema'] as const;
                    const index = views.indexOf(view);
                    const next =
                      event.key === 'ArrowRight'
                        ? views[(index + 1) % views.length]
                        : event.key === 'ArrowLeft'
                          ? views[(index + views.length - 1) % views.length]
                          : event.key === 'Home'
                            ? views[0]
                            : event.key === 'End'
                              ? views[2]
                              : undefined;
                    if (next) {
                      event.preventDefault();
                      void navigate({ search: (previous) => ({ ...previous, view: next }) });
                      documentWindowFocus(next);
                    }
                  }}
                >
                  {viewLabels[view]}
                </button>
              ))}
            </div>
            <div
              id="schema-tab-panel"
              role="tabpanel"
              aria-labelledby={`schema-tab-${search.view}`}
              tabIndex={0}
              className="schema-view"
            >
              {!target ? (
                <p role="alert">
                  This contract could not be resolved locally. Open JSON Schema to inspect its
                  definition.
                </p>
              ) : search.view === 'fields' ? (
                <SchemaFields
                  key={contract.id}
                  node={target.node}
                  documentId={target.documentId}
                  contractId={contract.id}
                />
              ) : search.view === 'schema' ? (
                <>
                  <p className="schema-view-note">
                    Original document; references resolve from the bundled catalogue.
                    {fragment ? ` Context is defined at ${fragment}.` : ''}
                  </p>
                  <PayloadViewer
                    key={`${contract.id}-schema`}
                    value={document}
                    title="JSON Schema"
                    allowYaml={false}
                  />
                </>
              ) : (
                <>
                  <p className="schema-view-note">
                    Synthetic example, validated against this protocol. Not captured project data.
                  </p>
                  <PayloadViewer
                    key={`${contract.id}-example`}
                    value={schemaExample(contract.id)}
                    title={contract.group === 'Payloads' ? 'Example payload' : 'Example'}
                    allowYaml={false}
                  />
                  <p className="schema-view-note schema-guidance">{schemaGuidance(contract.id)}</p>
                  <p className="schema-view-note">
                    Runtime admission also limits recursive JSON depth to {MAX_JSON_DEPTH} and
                    structural depth to {MAX_ENVELOPE_STRUCTURE_DEPTH}. Byte limits below apply to
                    serialized events and envelopes; JSON Schema alone does not express the full
                    admission policy.
                  </p>
                </>
              )}
            </div>
            <footer className="schema-footer">
              <span>
                {MAX_EVENT_BYTES / 1024} KiB per event · {MAX_ENVELOPE_BYTES / 1024 / 1024} MiB per
                envelope
              </span>
              <SchemaIdentifier key={contract.id} identifier={`${documentId}${fragment}`} />
            </footer>
          </div>
        </section>
      </main>
    </ConsoleShell>
  );
}

function SchemaIdentifier({ identifier }: { readonly identifier: string }): ReactElement {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <span className="schema-identifier">
      Schema: <code>{identifier}</code>
      <button
        className="icon-button"
        type="button"
        aria-label="Copy schema identifier"
        onClick={() =>
          void writeClipboard(identifier).then((copied) =>
            setCopyState(copied ? 'copied' : 'failed'),
          )
        }
      >
        <SpectroIcon name={copyState === 'copied' ? 'check' : 'copy'} size={16} />
      </button>
      <output className={copyState === 'failed' ? 'schema-copy-error' : 'sr-only'}>
        {copyState === 'copied'
          ? 'Schema identifier copied.'
          : copyState === 'failed'
            ? 'Copy failed. Select and copy the identifier manually.'
            : ''}
      </output>
    </span>
  );
}

function documentWindowFocus(view: SchemaView): void {
  window.requestAnimationFrame(() => window.document.getElementById(`schema-tab-${view}`)?.focus());
}

export function SchemaFields({
  node,
  documentId,
  contractId,
}: {
  node: SchemaNode;
  documentId: string;
  contractId: string;
}): ReactElement {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(contractId === 'error' ? ['/stack', '/fingerprint', '/source'] : []),
  );
  const { rows, limited } = useMemo(
    () => buildSchemaRows(node, documentId, expanded),
    [node, documentId, expanded],
  );
  return (
    <>
      <table className="schema-field-table" title={schemaConstraints(node).join(' · ')}>
        <caption className="sr-only">
          Fields and constraints. {schemaConstraints(node).join(' · ')}
        </caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Type</th>
            <th scope="col" title="Requiredness within the containing object">
              Presence
            </th>
            <th scope="col">Constraints</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.depth > 0 ? 'schema-nested-field' : undefined}>
              <th scope="row">
                <div
                  className="schema-field-name"
                  style={{ paddingInlineStart: `${Math.min(row.depth, 4) * 16}px` }}
                >
                  {row.expandable ? (
                    <button
                      type="button"
                      aria-expanded={expanded.has(row.id)}
                      aria-label={`${expanded.has(row.id) ? 'Collapse' : 'Expand'} ${row.id.slice(1).replace(/\//g, '.')}`}
                      onClick={() =>
                        setExpanded((previous) => {
                          const next = new Set(previous);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                    >
                      <SpectroIcon name="chevron" size={14} />
                      <code>{schemaFieldLabel(row)}</code>
                    </button>
                  ) : (
                    <>
                      <span className="schema-disclosure-spacer" aria-hidden="true" />
                      <code>{schemaFieldLabel(row)}</code>
                    </>
                  )}
                </div>
                {contractId === 'error' && errorFieldDescriptions[row.id] ? (
                  <p className="schema-field-description">{errorFieldDescriptions[row.id]}</p>
                ) : null}
              </th>
              <td>
                <span className="schema-mobile-label" aria-hidden="true">
                  Type
                </span>
                <code>{row.type}</code>
              </td>
              <td>
                <span className="schema-mobile-label" aria-hidden="true">
                  Presence
                </span>
                {row.presence === 'Item'
                  ? 'Array item'
                  : row.presence === 'Rule'
                    ? 'Schema rule'
                    : row.presence}
              </td>
              <td>
                <span className="schema-mobile-label" aria-hidden="true">
                  Constraints
                </span>
                {row.constraints.length
                  ? row.constraints.map((constraint) => <span key={constraint}>{constraint}</span>)
                  : '—'}
                {row.reference ? <small title={row.reference}>Local reference</small> : null}
                {row.note ? <small>{row.note}</small> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {limited ? (
        <output>
          Field expansion is limited to 200 rows. Use JSON Schema for the complete contract.
        </output>
      ) : null}
    </>
  );
}
