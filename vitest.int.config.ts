import { defineConfig } from 'vitest/config';

// Integration tests, against the test database in the Docker Postgres.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.int.test.ts'],
    globalSetup: ['packages/api/src/test/global-setup.ts'],
    // One database, wiped by tests that seed it.
    fileParallelism: false,
  },
});
