import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { requireEnv } from '../env.ts';
import { connect, parseDatabaseUrl } from './connection.ts';
import { exactlyOne } from './rows.ts';

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

/** Tables the API role may add rows to but never change or delete: a decision and a history entry are permanent. */
const APPEND_ONLY = ['mission_events', 'mission_approvals'];

/**
 * Runs the migrations as the owner, then grants the API role what it needs and nothing more:
 * it reads and writes rows, cannot rewrite history, and cannot create or delete an organisation
 * (organisations are seeded; the API only updates one, to take the next reference number).
 */
export async function migrateDatabase(ownerUrl: string, apiUrl: string): Promise<void> {
  const api = parseDatabaseUrl(apiUrl);
  const { client, db } = connect(ownerUrl);
  try {
    // Row-level security is forced, so it binds the owner unless the owner role bypasses it, which
    // only bootstrap grants. Migrated without it, the seed fails and login quietly finds no one.
    const owner = exactlyOne(
      await client<{ name: string; bypasses: boolean }[]>`
        SELECT rolname AS name, rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user`,
      'owner role',
    );
    if (!owner.bypasses) {
      throw new Error(
        `The owner role ${owner.name} cannot bypass row-level security, so the seed and login would see no organisation. Run \`pnpm demo:setup\`, which bootstraps the roles, then migrates.`,
      );
    }
    await migrate(db, { migrationsFolder });
    await client.unsafe(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${api.role};
      REVOKE UPDATE, DELETE ON ${APPEND_ONLY.join(', ')} FROM ${api.role};
      REVOKE INSERT, DELETE ON organisations FROM ${api.role};
      GRANT EXECUTE ON FUNCTION auth_find_user(text, text) TO ${api.role};
    `);
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await migrateDatabase(requireEnv('DATABASE_OWNER_URL'), requireEnv('DATABASE_URL'));
  console.log(`  migrated ${parseDatabaseUrl(requireEnv('DATABASE_OWNER_URL')).database}`);
}
