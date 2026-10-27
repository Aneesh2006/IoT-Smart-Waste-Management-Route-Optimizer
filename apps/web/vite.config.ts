import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const coreSrc = fileURLToPath(new URL('../../packages/core/src', import.meta.url));

/** The core package lives outside this app's root, so tell the dev server to watch it. */
const watchCore = (): Plugin => ({
  name: 'binsight:watch-core',
  configureServer(server) {
    server.watcher.add(coreSrc);
  },
});

/** Emit sw.js with the build's version and every output file to precache. */
const serviceWorker = (): Plugin => ({
  name: 'binsight:service-worker',
  apply: 'build',
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html');
    const template = readFileSync(fileURLToPath(new URL('./sw.template.js', import.meta.url)), 'utf8');
    this.emitFile({
      type: 'asset',
      fileName: 'sw.js',
      source: template.replace('__VERSION__', Date.now().toString(36)).replace('__FILES__', JSON.stringify(['index.html', 'favicon.svg', ...files])),
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), watchCore(), serviceWorker()],
  // Polling: native file events are unreliable on some Windows setups and edits get missed.
  // /api goes to the local API server (`pnpm dev:live`); in production Vercel serves it on the same origin.
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    host: true,
    watch: { usePolling: true, interval: 250 },
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 3001}`, changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
