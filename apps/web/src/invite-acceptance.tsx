import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { hostedConsole } from './auth-client.js';
import {
  acceptInvitation,
  claimInvitation,
  MemberRequestError,
  previewInvitation,
} from './member-client.js';
import { SpectroMark } from './spectro-icons.js';
import { ROLE_DESCRIPTIONS } from './workspace-members.js';

// The fragment never goes to a server or referrer. Remove it before rendering;
// coalesce the claim so React StrictMode does not redeem it twice.
let linkToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? undefined;
if (window.location.hash)
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
let claim: Promise<void> | undefined;
function prepareInvitation(): Promise<void> {
  if (claim) return claim;
  const token = linkToken;
  linkToken = undefined;
  claim =
    token === undefined
      ? Promise.resolve()
      : claimInvitation(token).catch((error: unknown) => {
          claim = undefined;
          linkToken = token;
          throw error;
        });
  return claim;
}

export function InviteAcceptance(): ReactNode {
  const query = useQuery({
    queryKey: ['invitation-preview'],
    queryFn: async () => {
      await prepareInvitation();
      return previewInvitation();
    },
    retry: false,
    enabled: hostedConsole,
  });
  const accept = useMutation({
    mutationFn: acceptInvitation,
    onSuccess: (result) => {
      window.location.assign(
        `/settings?${new URLSearchParams({ organization: result.organizationId, section: 'members', source: 'live', range: '24h' })}`,
      );
    },
  });
  const error = query.error ?? accept.error;
  const signedOut = error instanceof Error && error.message === 'signed_out';
  const switchAccount =
    error instanceof MemberRequestError &&
    (error.code === 'recipient_mismatch' || error.code === 'email_unverified');
  const loginFailed =
    new URLSearchParams(window.location.search).get('auth_error') === 'login_failed';
  return (
    <main className="workspace-gate">
      <section className="workspace-setup-panel invitation-acceptance" aria-labelledby="join-title">
        <a className="wordmark workspace-setup-brand" href="/" aria-label="Spectro">
          <SpectroMark />
          <span>spectro</span>
        </a>
        <h1 id="join-title">
          {query.data ? `Join ${query.data.organizationName}` : 'Join your workspace'}
        </h1>
        {!hostedConsole ? (
          <p className="workspace-intro">
            Invitation acceptance is available in the authenticated hosted Console.
          </p>
        ) : query.isPending ? (
          <output className="workspace-intro">Checking your invitation…</output>
        ) : signedOut ? (
          <>
            <p className="workspace-intro">
              Sign in with the email address your colleague invited. You’ll review your access
              before joining.
            </p>
            {loginFailed ? (
              <p role="alert" className="settings-form-error">
                Sign-in could not be completed. Check your account details and email verification,
                then try again.
              </p>
            ) : null}
            <a className="primary-button" href="/v1/auth/login?returnTo=%2Finvite">
              Sign in to continue
            </a>
          </>
        ) : error ? (
          <>
            <p className="workspace-intro" role="alert">
              {error.message === 'session_unavailable'
                ? 'Your session could not be checked. Try again in a moment.'
                : error.message}
            </p>
            {switchAccount ? (
              <a className="primary-button" href="/v1/auth/login?returnTo=%2Finvite&prompt=login">
                {error.code === 'email_unverified'
                  ? 'Sign in again after verification'
                  : 'Sign in with another account'}
              </a>
            ) : error instanceof MemberRequestError &&
              (error.status === 410 || error.code === 'already_member') ? (
              <a className="secondary-button" href="/">
                Open your workspaces
              </a>
            ) : (
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  accept.reset();
                  void query.refetch();
                }}
              >
                Try again
              </button>
            )}
          </>
        ) : query.data ? (
          <>
            <p className="workspace-intro">
              You’ve been invited to access all projects in this workspace.
            </p>
            <dl className="invitation-access">
              <div>
                <dt>Your role</dt>
                <dd>{query.data.role.charAt(0).toUpperCase() + query.data.role.slice(1)}</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>{ROLE_DESCRIPTIONS[query.data.role]}</dd>
              </div>
              <div>
                <dt>Link expires</dt>
                <dd>{new Date(query.data.expiresAt).toLocaleDateString()}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="primary-button"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? 'Joining workspace…' : 'Accept invitation'}
            </button>
            <p className="settings-security-note">
              Joining adds workspace access to your existing account. It does not create a new
              account.
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
