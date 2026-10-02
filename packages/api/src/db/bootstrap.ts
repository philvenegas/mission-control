import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { requireEnv } from '../env.ts';
import { parseDatabaseUrl } from './connection.ts';

/**
 * Creates the two database roles and a database, as the superuser. Safe to run again.
 *
 * - The owner owns the database and its tables, and runs migrations and the seed.
 * - The API role owns nothing and can bypass nothing, so row-level security can bind it.
 */
export async function bootstrapDatabase(adminUrl: string, ownerUrl: string, apiUrl: string): Promise<string[]> {
  const owner = parseDatabaseUrl(ownerUrl);
  const api = parseDatabaseUrl(apiUrl);
  if (api.database !== owner.database) throw new Error('The owner and API addresses name different databases');
  const done: string[] = [];

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    for (const role of [owner, api]) {
      const [existing] = await admin`SELECT 1 FROM pg_roles WHERE rolname = ${role.role}`;
      const password = role.password.replaceAll("'", "''");
      await admin.unsafe(
        `${existing ? 'ALTER' : 'CREATE'} ROLE ${role.role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${password}'`,
      );
      done.push(`${existing ? 'kept' : 'created'} role ${role.role}`);
    }
    const [existing] = await admin`SELECT 1 FROM pg_database WHERE datname = ${owner.database}`;
    if (!existing) await admin.unsafe(`CREATE DATABASE ${owner.database} OWNER ${owner.role}`);
    done.push(`${existing ? 'kept' : 'created'} database ${owner.database}`);
  } finally {
    await admin.end();
  }
  return done;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const admin = requireEnv('DATABASE_ADMIN_URL');
  const steps = [
    ...(await bootstrapDatabase(admin, requireEnv('DATABASE_OWNER_URL'), requireEnv('DATABASE_URL'))),
    ...(await bootstrapDatabase(admin, requireEnv('TEST_DATABASE_OWNER_URL'), requireEnv('TEST_DATABASE_URL'))),
  ];
  for (const step of new Set(steps)) console.log(`  ${step}`);
}
