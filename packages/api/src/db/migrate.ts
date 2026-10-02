import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { requireEnv } from '../env.ts';
import { connect, parseDatabaseUrl } from './connection.ts';

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/** Runs the migrations as the owner, then lets the API role read and write rows, and nothing more. */
export async function migrateDatabase(ownerUrl: string, apiUrl: string): Promise<void> {
  const api = parseDatabaseUrl(apiUrl);
  const { client, db } = connect(ownerUrl);
  try {
    await migrate(db, { migrationsFolder });
    await client.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${api.role}`);
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await migrateDatabase(requireEnv('DATABASE_OWNER_URL'), requireEnv('DATABASE_URL'));
  console.log(`  migrated ${parseDatabaseUrl(requireEnv('DATABASE_OWNER_URL')).database}`);
}
