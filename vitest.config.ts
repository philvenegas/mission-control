import { defineConfig } from 'vitest/config';

// The unit and integration tests, as two projects, so one run with --coverage measures both.
export default defineConfig({
  test: {
    projects: ['vitest.unit.config.ts', 'vitest.int.config.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/*/src/test/**'],
      // Every file not fully covered, with its uncovered lines: the list a reviewer checks for untested throws.
      reporter: [['text', { skipFull: true }]],
      // The level reached when coverage was first measured. Raise these as gaps close; never lower them.
      thresholds: { statements: 96, branches: 97, functions: 98, lines: 96 },
    },
  },
});
