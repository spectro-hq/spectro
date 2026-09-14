import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';

const signalSteps = [
  { id: 'capture', label: 'Capture', detail: 'track()' },
  { id: 'event', label: 'Event', detail: 'Protocol v1' },
  { id: 'envelope', label: 'Envelope', detail: 'Transport v1' },
  { id: 'ingest', label: 'Ingest', detail: 'Strict validation' },
  { id: 'store', label: 'Store', detail: 'Replaceable port' },
] as const;

function AppFrame() {
  return <Outlet />;
}

function Foundation() {
  return (
    <div className="observatory-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Spectro home">
          <span className="wordmark-mark" aria-hidden="true" />
          spectro
        </a>
        <output className="topbar-status">
          <span className="status-light" aria-hidden="true" />
          Foundation online
        </output>
      </header>

      <main className="foundation">
        <section className="mission" aria-labelledby="foundation-title">
          <p className="coordinate">Milestone V0.1 · Foundation</p>
          <h1 id="foundation-title">Signals now have a path.</h1>
          <p className="mission-copy">
            Spectro’s first verified slice carries a contextual custom event from the browser SDK to
            strict ingestion and a replaceable storage boundary.
          </p>
          <dl className="foundation-facts">
            <div>
              <dt>Protocol</dt>
              <dd>JSON Schema</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>TypeScript</dd>
            </div>
            <div>
              <dt>Boundary</dt>
              <dd>Web / API / Ingest</dd>
            </div>
          </dl>
        </section>

        <section className="signal-instrument" aria-labelledby="signal-path-title">
          <div className="instrument-heading">
            <div>
              <p className="instrument-label">Verified vertical slice</p>
              <h2 id="signal-path-title">checkout_started</h2>
            </div>
            <span className="protocol-tag">custom · v1</span>
          </div>

          <ol className="signal-path">
            {signalSteps.map((step, index) => (
              <li key={step.id} className="signal-node">
                <span className="node-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="node-core" aria-hidden="true" />
                <span className="node-copy">
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </span>
              </li>
            ))}
          </ol>

          <div className="event-readout" aria-label="Illustrative event readout">
            <span>project</span>
            <strong>prj_checkout</strong>
            <span>environment</span>
            <strong>production</strong>
            <span>accepted</span>
            <strong className="accepted">1 event</strong>
          </div>
          <p className="synthetic-note">Illustrative local event · no production telemetry</p>
        </section>
      </main>
    </div>
  );
}

const rootRoute = createRootRoute({ component: AppFrame });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Foundation,
});
const routeTree = rootRoute.addChildren([indexRoute]);
const router = createRouter({ routeTree });
const queryClient = new QueryClient();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Spectro root element is missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
