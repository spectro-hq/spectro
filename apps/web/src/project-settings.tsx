import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';

import { hostedConsole } from './auth-client.js';
import { ConsoleShell } from './console-shell.js';
import { parseExplorerSearch, type ExplorerSearch } from './event-query.js';
import { useWorkspace } from './workspace-context.js';
import {
  createProjectWriteKey,
  fetchProjectWriteKeys,
  revokeProjectWriteKey,
  type CreatedProjectWriteKey,
  type ProjectWriteKey,
} from './write-key-client.js';

export function ProjectSettings(): ReactNode {
  const search = parseExplorerSearch(
    Object.fromEntries(new URLSearchParams(window.location.search)),
  );

  return (
    <ConsoleShell title="Settings" search={search}>
      <ProjectSettingsContent search={search} />
    </ConsoleShell>
  );
}

function ProjectSettingsContent({ search }: { readonly search: ExplorerSearch }): ReactNode {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('Browser production');
  const [originsDraft, setOriginsDraft] = useState('');
  const [createdKey, setCreatedKey] = useState<CreatedProjectWriteKey>();
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [copied, setCopied] = useState<'key' | 'snippet'>();
  const project = workspace?.projects.find((item) => item.id === search.project);
  const organization = workspace?.organizations.find((item) => item.id === project?.organizationId);
  const canManageKeys = organization?.role === 'owner' || organization?.role === 'admin';
  const queryKey = ['project-write-keys', search.project, search.environment] as const;
  const keysQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      fetchProjectWriteKeys({
        projectId: search.project,
        environment: search.environment,
        signal,
      }),
    enabled: hostedConsole && canManageKeys,
  });
  const createMutation = useMutation({
    mutationFn: createProjectWriteKey,
    gcTime: 0,
    onSuccess: async (result) => {
      setCreatedKey(result);
      setCreateFormOpen(false);
      setFormError(undefined);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : 'Key creation failed.'),
  });
  const revokeMutation = useMutation({
    mutationFn: revokeProjectWriteKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const origins = originsDraft
    .split('\n')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const ingestionEndpoint = keysQuery.data?.ingestionEndpoint;
  const showCreateForm = !createdKey && (keysQuery.data?.data.length === 0 || createFormOpen);
  const snippet =
    createdKey && ingestionEndpoint
      ? browserSnippet({
          projectId: search.project,
          environment: search.environment,
          endpoint: ingestionEndpoint,
          key: createdKey.key,
        })
      : '';

  async function copy(value: string, target: 'key' | 'snippet'): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied(undefined), 1_800);
    } catch {
      setFormError('Clipboard access was denied. Select and copy the value manually.');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFormError(undefined);
    createMutation.mutate({
      projectId: search.project,
      environment: search.environment,
      label: label.trim(),
      allowedOrigins: origins,
    });
  }

  const eventsHref = `/?${new URLSearchParams({
    ...(search.organization === undefined ? {} : { organization: search.organization }),
    project: search.project,
    environment: search.environment,
    range: search.range,
    source: search.source,
  })}`;

  return (
    <main className="event-workspace settings-workspace">
      <header className="settings-heading">
        <div>
          <h1>Project settings</h1>
          <p>Manage browser ingestion keys for {project?.name ?? search.project}.</p>
        </div>
        <div className="settings-scope">
          <span>{project?.name ?? search.project}</span>
          <span aria-hidden="true">/</span>
          <strong>{search.environment}</strong>
        </div>
      </header>

      {!hostedConsole ? (
        <section className="settings-notice">
          <h2>Hosted project settings</h2>
          <p>Project write keys are managed in the authenticated hosted Console.</p>
        </section>
      ) : !canManageKeys ? (
        <section className="settings-notice">
          <h2>Ask an organization admin</h2>
          <p>Only organization Owners and Admins can view, create, or revoke ingestion keys.</p>
        </section>
      ) : keysQuery.isPending ? (
        <output className="settings-status" aria-live="polite">
          Loading project keys…
        </output>
      ) : keysQuery.isError ? (
        <section className="settings-notice" role="alert">
          <h2>Keys could not be loaded</h2>
          <p>{keysQuery.error.message}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void keysQuery.refetch()}
          >
            Try again
          </button>
        </section>
      ) : (
        <section className="settings-key-panel" aria-labelledby="write-keys-title">
          <div className="settings-section-heading">
            <div>
              <h2 id="write-keys-title">Browser write keys</h2>
              <p>Each key can send events to this project and environment only.</p>
            </div>
            {keysQuery.data.data.length > 0 && !createdKey ? (
              <button
                className="secondary-button"
                type="button"
                disabled={createMutation.isPending}
                onClick={() => {
                  setCreateFormOpen((open) => !open);
                  setFormError(undefined);
                }}
              >
                {createFormOpen ? 'Cancel' : 'Create key'}
              </button>
            ) : null}
          </div>

          {formError ? (
            <p className="settings-form-error" role="alert">
              {formError}
            </p>
          ) : null}

          {createdKey ? (
            <OneTimeKey
              keyValue={createdKey.key}
              snippet={snippet}
              copied={copied}
              onCopyKey={() => void copy(createdKey.key, 'key')}
              onCopySnippet={() => void copy(snippet, 'snippet')}
              onDismiss={() => {
                setCreatedKey(undefined);
                createMutation.reset();
              }}
            />
          ) : null}

          {keysQuery.data.data.length === 0 && !createdKey ? (
            <div className="settings-first-key">
              <div className="settings-first-key-mark" aria-hidden="true">
                <span />
              </div>
              <div>
                <h3>Connect your browser app</h3>
                <p>
                  Create a scoped key, add the SDK snippet, and your first events can arrive here.
                </p>
              </div>
            </div>
          ) : null}

          {showCreateForm ? (
            <form className="write-key-form" onSubmit={submit}>
              <label>
                <span>Key label</span>
                <input
                  autoComplete="off"
                  id="write-key-label"
                  maxLength={120}
                  value={label}
                  onChange={(event) => setLabel(event.currentTarget.value)}
                  required
                />
              </label>
              <label>
                <span>
                  Allowed browser origins <small>Optional, recommended</small>
                </span>
                <textarea
                  autoComplete="off"
                  rows={3}
                  placeholder={'https://app.example.com\nhttp://localhost:5173'}
                  value={originsDraft}
                  onChange={(event) => setOriginsDraft(event.currentTarget.value)}
                  spellCheck={false}
                />
                <small>
                  One origin per line. HTTPS is required except for localhost development.
                </small>
              </label>
              <button className="primary-button" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating key…' : 'Create browser key'}
              </button>
              <p className="settings-security-note">
                The secret is displayed once. It is stored as a verifier, not as readable key text.
              </p>
            </form>
          ) : null}

          {keysQuery.data.data.length > 0 ? (
            <div className="write-key-list" aria-label="Existing browser keys">
              {keysQuery.data.data.map((key) => (
                <WriteKeyRow
                  key={key.id}
                  item={key}
                  revoking={revokeMutation.isPending && revokeMutation.variables?.keyId === key.id}
                  onRevoke={() => {
                    if (key.revokedAt !== null) return;
                    if (
                      !window.confirm(
                        `Revoke “${key.label}”? Apps using it will stop sending events.`,
                      )
                    )
                      return;
                    revokeMutation.mutate({
                      projectId: search.project,
                      environment: search.environment,
                      keyId: key.id,
                    });
                  }}
                />
              ))}
            </div>
          ) : null}
          {revokeMutation.isError ? (
            <p className="settings-form-error" role="alert">
              {revokeMutation.error.message}
            </p>
          ) : null}
        </section>
      )}

      <aside className="settings-next-step">
        <div>
          <strong>Next: see your first event</strong>
          <span>Once the SDK is sending, events will appear in the event explorer.</span>
        </div>
        <a className="secondary-button" href={eventsHref}>
          Open Events
        </a>
      </aside>
    </main>
  );
}

function OneTimeKey({
  keyValue,
  snippet,
  copied,
  onCopyKey,
  onCopySnippet,
  onDismiss,
}: {
  readonly keyValue: string;
  readonly snippet: string;
  readonly copied: 'key' | 'snippet' | undefined;
  readonly onCopyKey: () => void;
  readonly onCopySnippet: () => void;
  readonly onDismiss: () => void;
}): ReactNode {
  return (
    <section className="one-time-key" aria-labelledby="key-created-title">
      <div className="one-time-key-heading">
        <div>
          <h3 id="key-created-title">Save this key now</h3>
          <p>For security, Spectro cannot show this secret again.</p>
        </div>
        <button className="text-button" type="button" onClick={onDismiss}>
          I saved it
        </button>
      </div>
      <div className="secret-field">
        <code>{keyValue}</code>
        <button className="secondary-button" type="button" onClick={onCopyKey}>
          {copied === 'key' ? 'Copied' : 'Copy key'}
        </button>
      </div>
      <div className="sdk-setup-heading">
        <div>
          <h4>Initialize the Browser SDK</h4>
          <p>
            Use this in your app entry point. The ingestion URL is configured for this deployment.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onCopySnippet}>
          {copied === 'snippet' ? 'Copied' : 'Copy snippet'}
        </button>
      </div>
      <pre className="sdk-snippet">
        <code>{snippet}</code>
      </pre>
      <p className="sdk-publish-note">
        The SDK package is currently available in this source workspace; publishing it to a package
        registry is a separate release step.
      </p>
    </section>
  );
}

function WriteKeyRow({
  item,
  revoking,
  onRevoke,
}: {
  readonly item: ProjectWriteKey;
  readonly revoking: boolean;
  readonly onRevoke: () => void;
}): ReactNode {
  return (
    <article className={`write-key-row${item.revokedAt === null ? '' : ' revoked'}`}>
      <div className="write-key-indicator" aria-hidden="true" />
      <div className="write-key-details">
        <div className="write-key-title-line">
          <strong>{item.label}</strong>
          <span>{item.revokedAt === null ? 'Active' : 'Revoked'}</span>
        </div>
        <code>{item.keyHint}</code>
        <small>
          Created{' '}
          {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(item.createdAt))}
          {item.allowedOrigins.length === 0
            ? ' · Any origin'
            : ` · ${item.allowedOrigins.length} allowed origin${item.allowedOrigins.length === 1 ? '' : 's'}`}
        </small>
      </div>
      {item.revokedAt === null ? (
        <button
          className="text-button revoke-key-button"
          type="button"
          onClick={onRevoke}
          disabled={revoking}
        >
          {revoking ? 'Revoking…' : 'Revoke'}
        </button>
      ) : null}
    </article>
  );
}

function browserSnippet(input: {
  readonly projectId: string;
  readonly environment: string;
  readonly endpoint: string;
  readonly key: string;
}): string {
  return `import { init } from '@spectro/browser';

init({
  projectId: ${JSON.stringify(input.projectId)},
  environment: ${JSON.stringify(input.environment)},
  endpoint: ${JSON.stringify(input.endpoint)},
  apiKey: ${JSON.stringify(input.key)},
});`;
}
