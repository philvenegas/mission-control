import { defineProject } from 'vitest/config';

// Unit tests. They need no database.
export default defineProject({
  test: {
    name: 'unit',
    include: ['packages/*/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.int.test.ts'],
  },
});
