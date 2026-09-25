import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  server: {
    fs: { allow: [workspaceRoot] },
    proxy: {
      '/ingest': {
        target: 'http://127.0.0.1:4401',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ingest/u, ''),
      },
    },
  },
  plugins: [
    {
      name: 'acceptance-network-failure',
      configureServer(server) {
        server.middlewares.use('/network-failure', (_request, response) => {
          response.statusCode = 503;
          response.setHeader('content-type', 'application/json');
          response.end('{"error":"simulated dependency failure"}');
        });
      },
    },
  ],
});
