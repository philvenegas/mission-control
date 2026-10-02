import { bootstrapDatabase } from '../db/bootstrap.ts';
import { migrateDatabase } from '../db/migrate.ts';
import { requireEnv } from '../env.ts';

export default async function setup() {
  const owner = requireEnv('TEST_DATABASE_OWNER_URL');
  const api = requireEnv('TEST_DATABASE_URL');
  try {
    await bootstrapDatabase(requireEnv('DATABASE_ADMIN_URL'), owner, api);
  } catch (error) {
    throw new Error('Cannot reach Postgres. Run `pnpm demo:setup` first, which starts it.', { cause: error });
  }
  await migrateDatabase(owner, api);
}
