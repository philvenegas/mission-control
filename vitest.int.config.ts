import { defineProject } from 'vitest/config';

// Integration tests, against the test database in the Docker Postgres.
export default defineProject({
  test: {
    name: 'integration',
    include: ['packages/*/src/**/*.int.test.ts'],
    globalSetup: ['packages/api/src/test/global-setup.ts'],
    // One database, wiped by tests that seed it, so one file at a time. Vitest 3 honours
    // `fileParallelism` only at the root, not in a project; a single fork is the project-level form.
    poolOptions: { forks: { singleFork: true } },
  },
});
