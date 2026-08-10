import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    env: {
      JWT_SECRET: 'test-jwt-secret-do-not-use-in-production',
    },
    setupFiles: ['./vitest.setup.ts'],
    alias: {
      '@': path.resolve(import.meta.dirname || '.', './src'),
    },
  },
});
