import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceContext, type WorkspaceSnapshot } from './workspace-context.js';
import { WorkspaceMembers } from './workspace-members.js';
import type { OrganizationRole } from './member-client.js';

vi.mock('./auth-client.js', () => ({
  hostedConsole: true,
  fetchConsoleSession: async () => ({ userId: 'usr_self', csrfToken: 'csrf' }),
}));
function fixtureWorkspace(role: OrganizationRole): WorkspaceSnapshot {
  return {
    organizations: [{ id: 'org_one', name: 'Example team', role }],
    projects: [],
  };
}
function render(role: OrganizationRole): string {
  const workspace = fixtureWorkspace(role);
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['console-session'], { userId: 'usr_self', csrfToken: 'csrf' });
  client.setQueryData(['organization-members', 'org_one'], {
    pages: [
      {
        data: [
          { id: 'usr_owner', email: 'owner@example.test', role: 'owner', active: true },
          { id: 'usr_self', email: 'self@example.test', role, active: true },
        ],
      },
    ],
    pageParams: [undefined],
  });
  client.setQueryData(['organization-invitations', 'org_one'], {
    pages: [{ data: [] }],
    pageParams: [undefined],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <WorkspaceContext.Provider value={workspace}>
        <WorkspaceMembers
          search={{
            organization: 'org_one',
            project: 'prj_missing',
            environment: 'dev',
            range: '6h',
            source: 'live',
            section: 'members',
          }}
        />
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  );
}
describe('workspace member UI integration', () => {
  it('renders organization-wide controls even before a project exists', () => {
    const markup = render('owner');
    expect(markup).toContain('Manage access to all projects in Example team');
    expect(markup).toContain('Invite member');
    expect(markup).toContain('aria-label="Role for owner@example.test"');
    expect(markup).toContain('self@example.test (you)');
    expect(markup).toContain('No invitations yet');
  });
  it('never offers Admins Owner changes and keeps read-only member views useful', () => {
    const admin = render('admin');
    expect(admin).not.toContain('aria-label="Role for owner@example.test"');
    expect(admin).not.toContain('<option value="owner"');
    for (const role of ['member', 'viewer'] as const) {
      const markup = render(role);
      expect(markup).toContain('owner@example.test');
      expect(markup).not.toContain('Invite member');
      expect(markup).not.toContain('<select');
      expect(markup).not.toContain('aria-label="Workspace invitations"');
      expect(markup).toContain('Only Owners and Admins');
    }
  });
});
