import { defineConfig } from 'vitest/config';

// Unit tests. They need no database.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
  },
});
