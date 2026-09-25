import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.SPECTRO_WEB_PORT ?? 5174),
    strictPort: true,
    proxy: {
      '/v1': process.env.SPECTRO_WEB_API_TARGET ?? 'http://127.0.0.1:4400',
    },
  },
});
