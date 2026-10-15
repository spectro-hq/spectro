import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeToggle } from './console-shared.js';
import { hostedConsole, logoutConsole } from './auth-client.js';
import type { DataSource, TimeRange } from './event-query.js';
import { SpectroIcon, SpectroMark } from './spectro-icons.js';
import { useWorkspace } from './workspace-context.js';
import type { ProjectSummary } from './workspace-client.js';

const destinations = [
  { title: 'Events', path: '/', icon: 'events' },
  { title: 'Issues', path: '/issues', icon: 'issues' },
  { title: 'Performance', path: '/performance', icon: 'performance' },
  { title: 'Network', path: '/network', icon: 'network' },
  { title: 'Releases', path: '/releases', icon: 'release' },
  { title: 'Live', path: '/live', icon: 'live' },
  { title: 'Schemas', path: '/schemas', icon: 'schemas' },
] as const;

export function ConsoleShell({
  title,
  search,
  children,
  reference = false,
}: {
  title: string;
  search: {
    organization?: string | undefined;
    project: string;
    environment: string;
    range: TimeRange;
    source: DataSource;
  };
  children: ReactNode;
  reference?: boolean;
}): ReactNode {
  const workspace = useWorkspace();
  const pathname = useLocation({ select: (location) => location.pathname });
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
  const scopeSearch = {
    ...(search.organization === undefined ? {} : { organization: search.organization }),
    project: search.project,
    environment: search.environment,
    range: search.range,
    source: search.source,
  };
  const selectedProject = workspace?.projects.find((project) => project.id === search.project);
  const navigation = (onNavigate?: () => void) => (
    <>
      <nav aria-label="Primary navigation">
        {destinations.map(({ title: label, path, icon }) => {
          const active = title === label || (title.startsWith('Session ') && path === '/');
          return (
            <Link
              key={path}
              className={`rail-link${active ? ' active' : ''}`}
              to={path}
              search={scopeSearch}
              aria-current={active ? 'page' : undefined}
              title={label}
              onClick={onNavigate}
            >
              <SpectroIcon name={icon} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
      <nav className="rail-secondary" aria-label="Secondary navigation">
        <Link
          className={`rail-link${title === 'Settings' ? ' active' : ''}`}
          to="/settings"
          search={{ ...scopeSearch, section: 'project' }}
          aria-current={title === 'Settings' ? 'page' : undefined}
          title="Settings"
          onClick={onNavigate}
        >
          <SpectroIcon name="settings" />
          <span>Settings</span>
        </Link>
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
          <Link className="wordmark" to="/" search={scopeSearch} aria-label="Spectro events">
            <SpectroMark />
            <span>spectro</span>
          </Link>
        </div>
        {navigation()}
      </aside>
      <header className="console-topbar shared-topbar">
        <Link
          className="wordmark topbar-brand"
          to="/"
          search={scopeSearch}
          aria-label="Spectro events"
        >
          <SpectroMark />
          <span>spectro</span>
        </Link>
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
            {reference ? (
              <span>Protocol</span>
            ) : (
              <Link to="/" search={scopeSearch}>
                {selectedProject?.name ?? search.project}
              </Link>
            )}
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
              pagePath={title.startsWith('Session ') ? '/' : pathname}
            />
          ) : null}
          <div className="runtime-state">
            {!reference ? (
              <span className={`status-light ${search.source}`} aria-hidden="true" />
            ) : null}
            <span>
              {reference
                ? 'Protocol reference'
                : search.source === 'live'
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
            <Link
              className="wordmark"
              to="/"
              search={scopeSearch}
              onClick={() => setMobileOpen(false)}
            >
              <SpectroMark />
              spectro
            </Link>
            <button
              className="sidebar-toggle"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <SidebarIcon />
            </button>
          </div>
          {navigation(() => setMobileOpen(false))}
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
  const navigate = useNavigate();
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
          void navigate({ href: `${pagePath}?${parameters.toString()}` });
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
