import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { pwaServiceWorker } from './scripts/vite-pwa';

/** Módulos de lógica pura que van en su propio trozo (no importan React ni los stores). */
const LOGIC_MODULES =
  /[\\/]src[\\/](simulation[\\/][^\\/]+\.ts|network[\\/].+\.ts|devices[\\/].+\.ts|automations[\\/](walk|autoName)\.ts|ui[\\/]plural\.ts|canvas[\\/](placement|geometry)\.ts|types\.ts)$/;

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
          // Lógica pura (motor, red, dispositivos, exportación): sin React ni stores.
          if (LOGIC_MODULES.test(id.split('?')[0] ?? id) && !/useDeviceOffline|png\.ts$/.test(id)) return 'logic';
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
    // emulator/ (laboratorio, backend opcional) tiene sus propios tests: cd emulator && npm test.
    exclude: [...configDefaults.exclude, 'emulator/**', '.claude/**'],
  },
});
