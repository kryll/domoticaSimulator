/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pwaServiceWorker } from './scripts/vite-pwa';

export default defineConfig({
  plugins: [react(), pwaServiceWorker()],
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas en trozos propios: se cachean entre versiones y ningún trozo pasa de 500 kB.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/@xyflow\//.test(id)) return 'xyflow';
          // Catálogo de dispositivos (datos) y resto de bibliotecas, en trozos propios.
          if (/[\\/]data[\\/][^\\/]+\.json$/.test(id)) return 'catalog-data';
          if (/node_modules\//.test(id) && !/html-to-image/.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
