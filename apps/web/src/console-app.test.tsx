// @vitest-environment happy-dom
import { createMemoryHistory } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildWorkspaceSelectionHref, createConsoleRouter } from './console-app.js';
import type { ProjectSummary } from './workspace-client.js';

const liveScope =
  'organization=org_one&project=prj_one&environment=production&range=24h&source=live';

function createTestRouter(initialEntry = `/?${liveScope}`) {
  return createConsoleRouter({
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    // Vitest runs in Node without `document`; force the client navigation path.
    isServer: false,
  });
}

const projectFixture: ProjectSummary = {
  id: 'prj_one',
  organizationId: 'org_one',
  name: 'Storefront',
  environments: ['staging', 'production'],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

// Mounts the hosted (PROD) console against a stubbed fetch so gate behavior —
// session load, workspace resolution, scope normalization — runs for real.
async function mountHostedConsole(initialEntry: string, projects: ProjectSummary[]) {
  vi.stubEnv('PROD', true);
  vi.resetModules();

  const requests: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    requests.push(url);
    const body = url.includes('/v1/auth/session')
      ? { userId: 'usr_1', csrfToken: 'csrf_1' }
      : url.includes('/v1/organizations?')
        ? { data: [{ id: 'org_one', name: 'Org One', role: 'owner' }] }
        : url.includes('/projects?')
          ? { data: projects }
          : { data: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const [
    { createConsoleRouter: freshCreateRouter },
    { RouterProvider, createMemoryHistory: freshMemoryHistory },
    { QueryClient, QueryClientProvider },
    { act },
    { createRoot },
  ] = await Promise.all([
    import('./console-app.js'),
    import('@tanstack/react-router'),
    import('@tanstack/react-query'),
    import('react'),
    import('react-dom/client'),
  ]);

  const router = freshCreateRouter({
    history: freshMemoryHistory({ initialEntries: [initialEntry] }),
    isServer: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  const teardown = async (): Promise<void> => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
  };
  return { router, requests, container, teardown };
}

describe('console router navigation', () => {
  it('navigates across pages client-side while preserving workspace scope', async () => {
    const router = createTestRouter();
    await router.load();
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.location.search).toMatchObject({
      organization: 'org_one',
      project: 'prj_one',
      environment: 'production',
      range: '24h',
      source: 'live',
    });

    const initialLength = router.history.length;
    await router.navigate({ href: `/issues?${liveScope}` });
    expect(router.state.location.pathname).toBe('/issues');
    expect(router.state.location.search).toMatchObject({
      organization: 'org_one',
      project: 'prj_one',
      environment: 'production',
      source: 'live',
    });
    expect(router.history.length).toBe(initialLength + 1);

    await router.navigate({ href: `/settings?${liveScope}&section=members` });
    expect(router.state.location.pathname).toBe('/settings');
    expect(router.state.location.search).toMatchObject({
      project: 'prj_one',
      section: 'members',
    });
  });

  it('resolves session deep links and validated search params', async () => {
    const router = createTestRouter();
    await router.load();
    await router.navigate({ href: `/sessions/sess_42?${liveScope}` });
    expect(router.state.location.pathname).toBe('/sessions/sess_42');
    expect(router.state.location.search).toMatchObject({
      project: 'prj_one',
      environment: 'production',
      source: 'live',
    });
  });

  it('applies route search validators during client-side navigation', async () => {
    const router = createTestRouter();
    await router.load();
    await router.navigate({ href: '/issues?project=invalid&range=bogus&source=live' });
    const search = router.state.location.search as Record<string, unknown>;
    expect(search.project).toBe('prj_checkout');
    expect(search.range).toBe('24h');
    expect(search.source).toBe('live');
  });

  it('normalizes workspace scope through history replace, not a document reload', async () => {
    const router = createTestRouter();
    await router.load();
    const before = router.history.length;
    await router.navigate({
      href: buildWorkspaceSelectionHref({
        pathname: '/settings',
        searchStr: '?section=members&range=6h',
        project: projectFixture,
        environment: 'staging',
        range: '6h',
        resetRouteState: false,
      }),
      replace: true,
    });
    expect(router.history.length).toBe(before);
    expect(router.state.location.pathname).toBe('/settings');
    expect(router.state.location.search).toMatchObject({
      organization: 'org_one',
      project: 'prj_one',
      environment: 'staging',
      source: 'live',
      section: 'members',
    });
  });

  it('never issues content requests for a scope that is still being normalized', async () => {
    const mounted = await mountHostedConsole(
      '/issues?project=prj_ghost&environment=production&range=24h&source=live&organization=org_one',
      [projectFixture],
    );

    expect(mounted.router.state.location.pathname).toBe('/issues');
    expect(mounted.router.state.location.search).toMatchObject({ project: 'prj_one' });
    expect(mounted.requests.some((url) => url.includes('prj_ghost'))).toBe(false);

    await mounted.teardown();
  });

  it('reaches organization members from a deep link when no project exists', async () => {
    const mounted = await mountHostedConsole('/settings?section=members&organization=org_one', []);

    expect(mounted.container.textContent).toContain('Members');
    expect(mounted.container.querySelector('.workspace-setup-panel')).toBeNull();
    expect(mounted.router.state.location.pathname).toBe('/settings');

    await mounted.teardown();
  });
});

describe('buildWorkspaceSelectionHref', () => {
  it('writes the resolved organization, project, environment, and live source', () => {
    const href = buildWorkspaceSelectionHref({
      pathname: '/issues',
      searchStr: '?name=runtime_error&range=6h',
      project: projectFixture,
      environment: 'staging',
      range: '6h',
      resetRouteState: false,
    });
    const [path, query] = href.split('?');
    expect(path).toBe('/issues');
    const parameters = new URLSearchParams(query);
    expect(parameters.get('organization')).toBe('org_one');
    expect(parameters.get('project')).toBe('prj_one');
    expect(parameters.get('environment')).toBe('staging');
    expect(parameters.get('source')).toBe('live');
    expect(parameters.get('name')).toBe('runtime_error');
    expect(parameters.get('range')).toBe('6h');
  });

  it('keeps the members section only when staying on settings', () => {
    const href = buildWorkspaceSelectionHref({
      pathname: '/settings',
      searchStr: '?section=members&range=6h',
      project: projectFixture,
      environment: 'staging',
      range: '6h',
      resetRouteState: false,
    });
    expect(new URLSearchParams(href.split('?')[1]).get('section')).toBe('members');
  });

  it('resets page state and leaves session pages when scope is invalid', () => {
    const href = buildWorkspaceSelectionHref({
      pathname: '/sessions/sess_9',
      searchStr: '?event=evt_1&range=6h',
      project: projectFixture,
      environment: 'staging',
      range: '6h',
      resetRouteState: true,
    });
    const [path, query] = href.split('?');
    expect(path).toBe('/');
    const parameters = new URLSearchParams(query);
    expect(parameters.get('event')).toBeNull();
    expect(parameters.get('range')).toBe('6h');
    expect(parameters.get('source')).toBe('live');
  });
});
