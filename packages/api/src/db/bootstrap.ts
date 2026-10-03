import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { requireEnv } from '../env.ts';
import { parseDatabaseUrl } from './connection.ts';

/**
 * Creates the two database roles and a database, as the superuser. Safe to run again.
 *
 * - The owner owns the database and its tables, and runs migrations and the seed. It bypasses
 *   row-level security, which binds even owners because it is forced: the seed writes every
 *   organisation, and the login lookup it owns finds a user before any organisation is known.
 * - The API role owns nothing and can bypass nothing, so row-level security binds it.
 */
export async function bootstrapDatabase(adminUrl: string, ownerUrl: string, apiUrl: string): Promise<string[]> {
  const owner = parseDatabaseUrl(ownerUrl);
  const api = parseDatabaseUrl(apiUrl);
  if (api.database !== owner.database) throw new Error(`The owner and API addresses name different databases: ${owner.database} and ${api.database}`);
  const done: string[] = [];

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    for (const [role, bypassAttribute] of [
      [owner, 'BYPASSRLS'],
      [api, 'NOBYPASSRLS'],
    ] as const) {
      const [roleExists] = await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role.role}`;
      const password = role.password.replaceAll("'", "''");
      await admin.unsafe(
        `${roleExists ? 'ALTER' : 'CREATE'} ROLE ${role.role} LOGIN NOSUPERUSER ${bypassAttribute} NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
      );
      done.push(`${roleExists ? 'kept' : 'created'} role ${role.role}`);
    }
    const [databaseExists] = await admin`SELECT 1 FROM pg_database WHERE datname = ${owner.database}`;
    if (!databaseExists) await admin.unsafe(`CREATE DATABASE ${owner.database} OWNER ${owner.role}`);
    done.push(`${databaseExists ? 'kept' : 'created'} database ${owner.database}`);
  } finally {
    await admin.end();
  }
  return done;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const admin = requireEnv('DATABASE_ADMIN_URL');
  const databases = [
    ['DATABASE_OWNER_URL', 'DATABASE_URL'],
    ['TEST_DATABASE_OWNER_URL', 'TEST_DATABASE_URL'],
  ] as const;
  for (const [ownerUrl, apiUrl] of databases) {
    for (const step of await bootstrapDatabase(admin, requireEnv(ownerUrl), requireEnv(apiUrl))) console.log(`  ${step}`);
  }
}
