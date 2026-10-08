import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';

import { fetchConsoleSession, hostedConsole } from './auth-client.js';
import {
  changeMemberRole,
  createInvitation,
  fetchMemberPage,
  removeMember,
  revokeInvitation,
  type CreatedInvitation,
  type OrganizationRole,
} from './member-client.js';
import type { SettingsSearch } from './settings-navigation.js';
import { useWorkspace } from './workspace-context.js';

export const ROLE_DESCRIPTIONS: Record<OrganizationRole, string> = {
  owner: 'Full workspace control, including Owners.',
  admin: 'Manage projects, keys and non-Owner members.',
  member: 'Read all projects and update issue status.',
  viewer: 'Read all projects. No changes.',
};
const roles: OrganizationRole[] = ['owner', 'admin', 'member', 'viewer'];
function roleLabel(role: OrganizationRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function WorkspaceMembers({ search }: { readonly search: SettingsSearch }): ReactNode {
  const workspace = useWorkspace();
  const project = workspace?.projects.find((item) => item.id === search.project);
  const organization = workspace?.organizations.find(
    (item) => item.id === (search.organization ?? project?.organizationId),
  );
  if (!hostedConsole || !organization)
    return (
      <main className="event-workspace settings-workspace">
        <SettingsSectionsNotice />
      </main>
    );
  return <MemberDirectory key={organization.id} organization={organization} />;
}
function SettingsSectionsNotice(): ReactNode {
  return (
    <section className="settings-notice">
      <h2>Hosted workspace members</h2>
      <p>
        Sign in to the hosted Console to manage your team. This preview does not create memberships
        or invitations.
      </p>
    </section>
  );
}
function MemberDirectory({
  organization,
}: {
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly role: OrganizationRole;
  };
}): ReactNode {
  const queryClient = useQueryClient();
  const canManage = organization.role === 'owner' || organization.role === 'admin';
  const memberKey = ['organization-members', organization.id] as const;
  const invitationKey = ['organization-invitations', organization.id] as const;
  const session = useQuery({
    queryKey: ['console-session'],
    queryFn: fetchConsoleSession,
    retry: false,
  });
  const members = useInfiniteQuery({
    queryKey: memberKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchMemberPage({
        organizationId: organization.id,
        kind: 'members',
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const invitations = useInfiniteQuery({
    queryKey: invitationKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchMemberPage({
        organizationId: organization.id,
        kind: 'invitations',
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: canManage,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationRole>('member');
  const [created, setCreated] = useState<CreatedInvitation>();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: memberKey }),
      queryClient.invalidateQueries({ queryKey: invitationKey }),
      queryClient.invalidateQueries({ queryKey: ['organizations'] }),
    ]);
  }
  const invite = useMutation({
    mutationFn: createInvitation,
    gcTime: 0,
    onSuccess: async (result) => {
      setCreated(result);
      setFormOpen(false);
      setEmail('');
      setCopied(false);
      setCopyError(undefined);
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: revokeInvitation,
    onSuccess: async () => {
      setNotice('Invitation revoked. Its link can no longer be used.');
      await refresh();
    },
  });
  const change = useMutation({
    mutationFn: changeMemberRole,
    onSuccess: async () => {
      setNotice('Role updated. Permissions apply immediately.');
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: removeMember,
    onSuccess: async (_, input) => {
      if (input.memberId === session.data?.userId) {
        window.location.assign('/');
        return;
      }
      setNotice('Member removed from this workspace.');
      await refresh();
    },
  });
  const busy = invite.isPending || revoke.isPending || change.isPending || remove.isPending;
  const error = invite.error ?? revoke.error ?? change.error ?? remove.error;
  function clearFeedback(): void {
    invite.reset();
    revoke.reset();
    change.reset();
    remove.reset();
    setNotice(undefined);
  }
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    clearFeedback();
    invite.mutate({ organizationId: organization.id, email: email.trim(), role });
  }
  async function copyLink(): Promise<void> {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
      setCopyError(undefined);
    } catch {
      setCopyError('Clipboard access was denied. Select and copy the link below.');
    }
  }
  const memberRows = members.data?.pages.flatMap((page) => page.data) ?? [];
  const inviteRows = invitations.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <main className="event-workspace settings-workspace members-workspace">
      <header className="settings-heading">
        <div>
          <h1>Workspace members</h1>
          <p>Manage access to all projects in {organization.name}.</p>
        </div>
        <span className="settings-scope">
          Your role: <strong>{roleLabel(organization.role)}</strong>
        </span>
      </header>
      <section className="settings-key-panel" aria-labelledby="members-title">
        <div className="settings-section-heading">
          <div>
            <h2 id="members-title">Members</h2>
            <p>Members share access across this workspace. Keep at least one active Owner.</p>
          </div>
          {canManage && !created ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              aria-expanded={formOpen}
              onClick={() => {
                clearFeedback();
                setFormOpen(!formOpen);
              }}
            >
              {formOpen ? 'Cancel invitation' : 'Invite member'}
            </button>
          ) : null}
        </div>
        <div aria-live="polite">
          {notice ? <p className="members-feedback">{notice}</p> : null}
          {error ? (
            <p className="settings-form-error" role="alert">
              {error.message}
            </p>
          ) : null}
        </div>
        {formOpen ? (
          <form className="write-key-form member-invite-form" onSubmit={submit}>
            <label>
              <span>Email address</span>
              <input
                type="email"
                autoComplete="email"
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
                required
              />
            </label>
            <label>
              <span>Workspace role</span>
              <RoleSelect
                value={role}
                ownerAllowed={organization.role === 'owner'}
                onChange={setRole}
                disabled={busy}
                label="Invitation role"
              />
              <small>{ROLE_DESCRIPTIONS[role]}</small>
            </label>
            <button className="primary-button" type="submit" disabled={busy}>
              {invite.isPending ? 'Creating invitation…' : 'Create invitation link'}
            </button>
            <p className="settings-security-note">
              You’ll copy and share the link yourself. Spectro does not send an email.
            </p>
          </form>
        ) : null}
        {created ? (
          <section className="one-time-key" aria-labelledby="invitation-created-title">
            <div className="one-time-key-heading">
              <div>
                <h3 id="invitation-created-title">Share this invitation</h3>
                <p>
                  For {created.email} · {roleLabel(created.role)} · expires{' '}
                  {new Date(created.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setCreated(undefined);
                  invite.reset();
                  setCopyError(undefined);
                }}
              >
                I saved it
              </button>
            </div>
            <label className="invitation-link-field">
              <span>One-time invitation link</span>
              <input
                value={created.link}
                readOnly
                autoComplete="off"
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <div className="member-actions">
              <button className="secondary-button" type="button" onClick={() => void copyLink()}>
                {copied ? 'Link copied' : 'Copy invitation link'}
              </button>
              <span>Shown once. Only the verified recipient can join.</span>
            </div>
            {copyError ? (
              <p role="alert" className="settings-form-error">
                {copyError}
              </p>
            ) : null}
          </section>
        ) : null}
        {members.isPending ? (
          <output className="members-feedback">Loading members…</output>
        ) : members.isError ? (
          <ListError message={members.error.message} onRetry={() => void members.refetch()} />
        ) : (
          <>
            <ul className="member-list" aria-label="Workspace members">
              {memberRows.map((person) => (
                <li key={person.id}>
                  <div className="member-identity">
                    <strong>
                      {person.email ?? person.id}
                      {person.id === session.data?.userId ? ' (you)' : ''}
                    </strong>
                    <span>
                      {person.active
                        ? ROLE_DESCRIPTIONS[person.role]
                        : 'Account disabled. Cannot access this workspace.'}
                    </span>
                  </div>
                  <div className="member-actions">
                    {canManage && (organization.role === 'owner' || person.role !== 'owner') ? (
                      <>
                        <RoleSelect
                          value={person.role}
                          ownerAllowed={organization.role === 'owner'}
                          disabled={busy}
                          label={`Role for ${person.email ?? person.id}`}
                          onChange={(next) => {
                            if (
                              next === person.role ||
                              !window.confirm(
                                `Change ${person.email ?? person.id} from ${roleLabel(person.role)} to ${roleLabel(next)}? ${ROLE_DESCRIPTIONS[next]}`,
                              )
                            )
                              return;
                            clearFeedback();
                            change.mutate({
                              organizationId: organization.id,
                              member: person,
                              role: next,
                            });
                          }}
                        />
                        <button
                          className="text-button member-remove"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Remove ${person.email ?? person.id} from ${organization.name}? Access to all its projects will end.`,
                              )
                            )
                              return;
                            clearFeedback();
                            remove.mutate({ organizationId: organization.id, memberId: person.id });
                          }}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <span>{roleLabel(person.role)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {members.hasNextPage ? (
              <button
                className="secondary-button"
                type="button"
                disabled={members.isFetchingNextPage}
                onClick={() => void members.fetchNextPage()}
              >
                {members.isFetchingNextPage ? 'Loading…' : 'Load more members'}
              </button>
            ) : null}
          </>
        )}
      </section>
      {canManage ? (
        <section className="settings-key-panel" aria-labelledby="invitations-title">
          <div className="settings-section-heading">
            <div>
              <h2 id="invitations-title">Invitations</h2>
              <p>Single-use links expire after seven days.</p>
            </div>
          </div>
          {invitations.isPending ? (
            <output className="members-feedback">Loading invitations…</output>
          ) : invitations.isError ? (
            <ListError
              message={invitations.error.message}
              onRetry={() => void invitations.refetch()}
            />
          ) : inviteRows.length === 0 ? (
            <p className="members-feedback">
              No invitations yet. Use Invite member to bring a colleague into this workspace.
            </p>
          ) : (
            <ul className="member-list" aria-label="Workspace invitations">
              {inviteRows.map((item) => (
                <li key={item.id}>
                  <div className="member-identity">
                    <strong>{item.email}</strong>
                    <span>
                      {roleLabel(item.role)} · expires{' '}
                      {new Date(item.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="member-actions">
                    <span className="invitation-status">
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    </span>
                    {item.status === 'pending' &&
                    (organization.role === 'owner' || item.role !== 'owner') ? (
                      <button
                        type="button"
                        className="text-button member-remove"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Revoke the invitation for ${item.email}? Its link will stop working.`,
                            )
                          )
                            return;
                          clearFeedback();
                          revoke.mutate({ organizationId: organization.id, invitationId: item.id });
                        }}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {invitations.hasNextPage ? (
            <button
              className="secondary-button"
              type="button"
              disabled={invitations.isFetchingNextPage}
              onClick={() => void invitations.fetchNextPage()}
            >
              {invitations.isFetchingNextPage ? 'Loading…' : 'Load more invitations'}
            </button>
          ) : null}
        </section>
      ) : (
        <p className="members-feedback">Only Owners and Admins can invite or manage members.</p>
      )}
    </main>
  );
}
function RoleSelect({
  value,
  ownerAllowed,
  disabled,
  label,
  onChange,
}: {
  readonly value: OrganizationRole;
  readonly ownerAllowed: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (role: OrganizationRole) => void;
}): ReactNode {
  return (
    <select
      className="member-role-select"
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => {
        const selected = roles.find((item) => item === event.currentTarget.value);
        if (selected) onChange(selected);
      }}
    >
      {roles
        .filter((item) => ownerAllowed || item !== 'owner')
        .map((item) => (
          <option key={item} value={item}>
            {roleLabel(item)}
          </option>
        ))}
    </select>
  );
}
function ListError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}): ReactNode {
  return (
    <div className="members-feedback" role="alert">
      <p>{message}</p>
      <button className="secondary-button" type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
