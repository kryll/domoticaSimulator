import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['orchestrator/test/**/*.test.ts'],
    testTimeout: 15000,
  },
});
