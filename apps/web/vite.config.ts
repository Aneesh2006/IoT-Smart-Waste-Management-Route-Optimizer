import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
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

export default defineConfig({
  plugins: [react(), tailwindcss(), watchCore()],
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 2000 },
});
