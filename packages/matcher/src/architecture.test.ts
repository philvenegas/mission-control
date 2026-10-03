import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const src = fileURLToPath(new URL('.', import.meta.url));

const sourceFiles = readdirSync(src).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

it('imports nothing but the contract and its own files: no API, no database, no HTTP, no Node (DESIGN.md section 9, rule 4)', () => {
  const imports = sourceFiles.flatMap((file) => [...readFileSync(join(src, file), 'utf8').matchAll(/from '([^']+)'/g)].map(([, from = '']) => `${file}: ${from}`));
  expect(imports.length).toBeGreaterThan(0);
  expect(imports.filter((line) => !/: (@mission-control\/contract|\.\/[\w-]+\.ts)$/.test(line))).toEqual([]);
});
