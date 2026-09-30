import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeToggle } from './console-shared.js';
import { hostedConsole, logoutConsole } from './auth-client.js';
import { SpectroIcon, SpectroMark } from './spectro-icons.js';
import { useWorkspace } from './workspace-context.js';
import type { ProjectSummary } from './workspace-client.js';

const destinations = [
  { title: 'Events', path: '/', icon: 'events' },
  { title: 'Issues', path: '/issues', icon: 'issues' },
  { title: 'Performance', path: '/performance', icon: 'performance' },
  { title: 'Network', path: '/network', icon: 'network' },
  { title: 'Releases', path: '/releases', icon: 'release' },
] as const;

export function ConsoleShell({
  title,
  search,
  children,
}: {
  title: string;
  search: {
    organization?: string | undefined;
    project: string;
    environment: string;
    range: string;
    source: string;
  };
  children: ReactNode;
}): ReactNode {
  const workspace = useWorkspace();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('spectro.sidebar.collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signoutError, setSignoutError] = useState(false);
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (mobileOpen) drawer.current?.showModal();
    else drawer.current?.close();
  }, [mobileOpen]);
  const parameters = new URLSearchParams({
    project: search.project,
    environment: search.environment,
    range: search.range,
    source: search.source,
  });
  if (search.organization !== undefined) parameters.set('organization', search.organization);
  const selectedProject = workspace?.projects.find((project) => project.id === search.project);
  const navigation = (
    <>
      <nav aria-label="Primary navigation">
        {destinations.map(({ title: label, path, icon }) => {
          const active = title === label || (title.startsWith('Session ') && path === '/');
          return (
            <a
              key={path}
              className={`rail-link${active ? ' active' : ''}`}
              href={`${path}?${parameters}`}
              aria-current={active ? 'page' : undefined}
              title={label}
            >
              <SpectroIcon name={icon} />
              <span>{label}</span>
            </a>
          );
        })}
        {(['live', 'schemas'] as const).map((icon) => (
          <span
            key={icon}
            className="rail-link"
            aria-disabled="true"
            title={icon === 'live' ? 'Live' : 'Schemas'}
          >
            <SpectroIcon name={icon} />
            <span>{icon === 'live' ? 'Live' : 'Schemas'}</span>
          </span>
        ))}
      </nav>
      <nav className="rail-secondary" aria-label="Secondary navigation">
        <a
          className={`rail-link${title === 'Settings' ? ' active' : ''}`}
          href={`/settings?${parameters}`}
          aria-current={title === 'Settings' ? 'page' : undefined}
          title="Settings"
        >
          <SpectroIcon name="settings" />
          <span>Settings</span>
        </a>
        <span className="rail-link" aria-disabled="true" title="API Guide">
          <SpectroIcon name="book" />
          <span>API Guide</span>
        </span>
      </nav>
    </>
  );
  return (
    <div className={`console-shell shared-shell${collapsed ? ' rail-collapsed' : ''}`}>
      <aside className="console-rail shared-rail" id="console-sidebar" aria-label="Sidebar">
        <div className="rail-brand desktop-rail-brand">
          <a className="wordmark" href={`/?${parameters}`} aria-label="Spectro events">
            <SpectroMark />
            <span>spectro</span>
          </a>
        </div>
        {navigation}
      </aside>
      <header className="console-topbar shared-topbar">
        <a className="wordmark topbar-brand" href={`/?${parameters}`} aria-label="Spectro events">
          <SpectroMark />
          <span>spectro</span>
        </a>
        <div className="shell-heading">
          <button
            className="sidebar-toggle desktop-collapse"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-controls="console-sidebar"
            aria-expanded={!collapsed}
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              try {
                localStorage.setItem('spectro.sidebar.collapsed', String(next));
              } catch {
                /* Preference remains available for this page. */
              }
            }}
          >
            <SidebarIcon />
          </button>
          <button
            className="sidebar-toggle mobile-menu"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <SidebarIcon />
          </button>
          <nav className="shell-breadcrumbs" aria-label="Breadcrumb">
            <a href={`/?${parameters}`}>{selectedProject?.name ?? search.project}</a>
            <SpectroIcon name="chevron" size={14} />
            <span aria-current="page">{title}</span>
          </nav>
        </div>
        <div className="topbar-actions">
          {hostedConsole && workspace ? (
            <WorkspaceSwitcher
              projects={workspace.projects}
              organizations={workspace.organizations}
              selectedProject={selectedProject}
              range={search.range}
              pagePath={title.startsWith('Session ') ? '/' : window.location.pathname}
            />
          ) : null}
          <div className="runtime-state">
            <span className={`status-light ${search.source}`} aria-hidden="true" />
            <span>
              {search.source === 'live'
                ? hostedConsole
                  ? 'Hosted Console'
                  : 'Local API connected'
                : 'Illustrative workspace'}
            </span>
          </div>
          {hostedConsole ? (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                void logoutConsole().catch(() => setSignoutError(true));
              }}
            >
              Sign out
            </button>
          ) : null}
          <ThemeToggle />
        </div>
      </header>
      {signoutError ? <p role="alert">Sign out failed. Please try again.</p> : null}
      {children}
      <dialog
        className="mobile-navigation"
        ref={drawer}
        onClose={() => setMobileOpen(false)}
        aria-label="Navigation"
      >
        <div className="mobile-navigation-body">
          <div className="rail-brand">
            <a className="wordmark" href={`/?${parameters}`}>
              <SpectroMark />
              spectro
            </a>
            <button
              className="sidebar-toggle"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <SidebarIcon />
            </button>
          </div>
          {navigation}
        </div>
      </dialog>
    </div>
  );
}

function WorkspaceSwitcher({
  organizations,
  projects,
  selectedProject,
  range,
  pagePath,
}: {
  organizations: NonNullable<ReturnType<typeof useWorkspace>>['organizations'];
  projects: NonNullable<ReturnType<typeof useWorkspace>>['projects'];
  selectedProject: ProjectSummary | undefined;
  range: string;
  pagePath: string;
}): ReactNode {
  return (
    <label className="workspace-switcher">
      <span>Workspace</span>
      <select
        aria-label="Organization and project"
        value={selectedProject?.id ?? ''}
        onChange={(event) => {
          const project = projects.find((item) => item.id === event.currentTarget.value);
          if (project === undefined) return;
          const parameters = new URLSearchParams({
            organization: project.organizationId,
            project: project.id,
            environment: project.environments[0] ?? 'production',
            range,
            source: 'live',
          });
          window.location.assign(`${pagePath}?${parameters.toString()}`);
        }}
      >
        {organizations.map((organization) => {
          const organizationProjects = projects.filter(
            (project) => project.organizationId === organization.id,
          );
          return organizationProjects.length > 0 ? (
            <optgroup key={organization.id} label={`${organization.name} · ${organization.role}`}>
              {organizationProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </select>
    </label>
  );
}

function SidebarIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="M8 3.5v13" />
    </svg>
  );
}
