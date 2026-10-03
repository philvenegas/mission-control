// The mechanical half of CODING_STANDARDS.md. A rule a reviewer would only restate lives here instead.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', 'packages/api/src/db/migrations/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Types: no casts to get past the compiler. `as const` stays allowed.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      // Names: a name says what the value holds, so no single letters (`_` marks a value left unused).
      'id-length': ['error', { min: 2, exceptions: ['_'], properties: 'never' }],
    },
  },
);
