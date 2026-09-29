import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Serve the production build so the Console exercises hosted cookie sessions.
// Preview serves only dist; the root-level credentials and private key stay private.
export default defineConfig({
  preview: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    https: {
      key: readFileSync(new URL('../../.local/auth/localhost-key.pem', import.meta.url)),
      cert: readFileSync(new URL('../../.local/auth/localhost.pem', import.meta.url)),
    },
    proxy: {
      '/v1': { target: 'http://127.0.0.1:4488', changeOrigin: false },
      '/health': { target: 'http://127.0.0.1:4488', changeOrigin: false },
    },
  },
});
