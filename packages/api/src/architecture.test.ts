import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('.', import.meta.url));

const sourceFiles = (directory: string): string[] =>
  readdirSync(join(src, directory), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => relative(src, join(entry.parentPath, entry.name)));

const importsOf = (file: string) => [...readFileSync(join(src, file), 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');

/** The names a file imports by name, from any module: `{ a, type B }` gives a and B. */
const namedImportsOf = (file: string) =>
  [...readFileSync(join(src, file), 'utf8').matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)].flatMap(([, names = '']) =>
    names
      .split(',')
      .map((name) => name.trim().replace(/^type\s+/, ''))
      .filter(Boolean),
  );

/** Files under `directory` that import a name matching `name`. */
const filesImportingName = (directory: string, name: RegExp) =>
  sourceFiles(directory).filter((file) => namedImportsOf(file).some((imported) => name.test(imported)));

/** Files under `directory` that import something matching `forbidden`. */
const offenders = (directory: string, forbidden: RegExp) =>
  sourceFiles(directory).filter((file) => importsOf(file).some((imported) => forbidden.test(imported)));

describe('the code structure rules of DESIGN.md section 9', () => {
  it('finds the module files it checks', () => {
    expect(sourceFiles('modules')).toEqual(expect.arrayContaining(['modules/org/repository.ts', 'modules/users/service.ts']));
  });

  it('gives modules no way to reach the database except the request\'s transaction', () => {
    expect(offenders('modules', /db\/connection\.ts$|^postgres$|drizzle-orm\/postgres-js/)).toEqual([]);
  });

  it('keeps HTTP out of services and repositories', () => {
    const notRoutes = sourceFiles('modules').filter((file) => !file.endsWith('routes.ts'));
    expect(notRoutes.filter((file) => importsOf(file).some((imported) => /^hono|\/http\//.test(imported)))).toEqual([]);
  });

  it('keeps data access out of route handlers\' imports of the schema', () => {
    const routes = sourceFiles('modules').filter((file) => file.endsWith('routes.ts'));
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((file) => importsOf(file).some((imported) => /db\/schema\.ts$|^drizzle-orm/.test(imported)))).toEqual([]);
  });

  it('changes a mission\'s status only through the lifecycle module', () => {
    const missionWriters = sourceFiles('modules').filter((file) => /\.update\(missions\)/.test(readFileSync(join(src, file), 'utf8')));
    expect(missionWriters).toEqual(['modules/missions/repository.ts']);
    expect(filesImportingName('modules', /^(moveMission|startSubmission)$/)).toEqual(['modules/missions/lifecycle.ts']);
  });

  it('can tell an offender when there is one', () => {
    expect(offenders('db', /^postgres$/)).toContain('db/connection.ts');
    expect(namedImportsOf('modules/missions/service.ts')).toContain('runTransition');
  });
});
