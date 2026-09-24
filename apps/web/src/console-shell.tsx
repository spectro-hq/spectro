import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeToggle } from './console-shared.js';
import { SpectroIcon, SpectroMark } from './spectro-icons.js';

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
  search: { project: string; environment: string; range: string; source: string };
  children: ReactNode;
}): ReactNode {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('spectro.sidebar.collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
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
  const navigation = (
    <>
      <nav aria-label="Primary navigation">
        {destinations.map(({ title: label, path, icon }) => (
          <a
            key={path}
            className={`rail-link${title === label || (title.startsWith('Session ') && path === '/') ? ' active' : ''}`}
            href={`${path}?${parameters}`}
            aria-current={title === label ? 'page' : undefined}
            title={label}
          >
            <SpectroIcon name={icon} />
            <span>{label}</span>
          </a>
        ))}
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
        <span className="rail-link" aria-disabled="true" title="Settings">
          <SpectroIcon name="settings" />
          <span>Settings</span>
        </span>
        <span className="rail-link" aria-disabled="true" title="API Guide">
          <SpectroIcon name="book" />
          <span>API Guide</span>
        </span>
      </nav>
    </>
  );
  return (
    <div className={`console-shell shared-shell${collapsed ? ' rail-collapsed' : ''}`}>
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
            <a href={`/?${parameters}`}>{search.project}</a>
            <SpectroIcon name="chevron" size={14} />
            <span aria-current="page">{title}</span>
          </nav>
        </div>
        <div className="topbar-actions">
          <div className="runtime-state">
            <span className={`status-light ${search.source}`} aria-hidden="true" />
            <span>
              {search.source === 'live' ? 'Local API connected' : 'Illustrative workspace'}
            </span>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <aside className="console-rail shared-rail" id="console-sidebar" aria-label="Sidebar">
        {navigation}
      </aside>
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
