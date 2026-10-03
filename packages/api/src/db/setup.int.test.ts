import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { requireEnv } from '../env.ts';
import { bootstrapDatabase } from './bootstrap.ts';
import { migrateDatabase } from './migrate.ts';

// Setup against a database and two roles of its own, created here and dropped afterwards, so the
// test database the other tests use is never touched.
const ROLES = { owner: 'mc_owner_setup_test', api: 'mc_api_setup_test' };
const DATABASE = 'mission_control_setup_test';

/** The test database's address, with another role and database in it. */
function addressOf(role: string, database = DATABASE): string {
  const address = new URL(requireEnv('TEST_DATABASE_OWNER_URL'));
  address.username = role;
  address.password = role;
  address.pathname = `/${database}`;
  return address.href;
}

const admin = postgres(requireEnv('DATABASE_ADMIN_URL'), { max: 1, onnotice: () => {} });

afterAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  for (const role of Object.values(ROLES)) await admin.unsafe(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
});

const roleAttributes = (role: string) =>
  admin`SELECT rolname AS name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = ${role}`;

describe('bootstrap', () => {
  it('creates the owner, who bypasses row-level security, the API role, who cannot, and a database the owner owns', async () => {
    expect(await bootstrapDatabase(requireEnv('DATABASE_ADMIN_URL'), addressOf(ROLES.owner), addressOf(ROLES.api))).toEqual([
      `created role ${ROLES.owner}`,
      `created role ${ROLES.api}`,
      `created database ${DATABASE}`,
    ]);
    expect(await roleAttributes(ROLES.owner)).toEqual([
      { name: ROLES.owner, rolsuper: false, rolbypassrls: true, rolcreatedb: false, rolcreaterole: false },
    ]);
    expect(await roleAttributes(ROLES.api)).toEqual([
      { name: ROLES.api, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false },
    ]);
    const [database] = await admin`SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = ${DATABASE}`;
    expect(database).toEqual({ owner: ROLES.owner });
  });

  it('is safe to run again, and restores an owner role that lost its bypass', async () => {
    await admin.unsafe(`ALTER ROLE ${ROLES.owner} NOBYPASSRLS`);
    expect(await bootstrapDatabase(requireEnv('DATABASE_ADMIN_URL'), addressOf(ROLES.owner), addressOf(ROLES.api))).toEqual([
      `kept role ${ROLES.owner}`,
      `kept role ${ROLES.api}`,
      `kept database ${DATABASE}`,
    ]);
    expect(await roleAttributes(ROLES.owner)).toMatchObject([{ rolbypassrls: true }]);
  });
});

describe('migrating', () => {
  const tablesIn = async () => {
    const database = postgres(addressOf(ROLES.owner), { max: 1, onnotice: () => {} });
    try {
      return (await database`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).length;
    } finally {
      await database.end();
    }
  };

  it('refuses, changing nothing, when the owner cannot bypass row-level security, and names the command that fixes it', async () => {
    await admin.unsafe(`ALTER ROLE ${ROLES.owner} NOBYPASSRLS`);
    await expect(migrateDatabase(addressOf(ROLES.owner), addressOf(ROLES.api))).rejects.toThrow(
      `The owner role ${ROLES.owner} cannot bypass row-level security, so the seed and login would see no organisation. Run \`pnpm demo:setup\`, which bootstraps the roles, then migrates.`,
    );
    expect(await tablesIn()).toBe(0);
  });

  it('migrates once bootstrap has run', async () => {
    await bootstrapDatabase(requireEnv('DATABASE_ADMIN_URL'), addressOf(ROLES.owner), addressOf(ROLES.api));
    await migrateDatabase(addressOf(ROLES.owner), addressOf(ROLES.api));
    expect(await tablesIn()).toBeGreaterThan(0);
  });
});
