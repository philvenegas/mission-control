import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type { Sql, TransactionSql } from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';
import { requireEnv } from '../env.ts';
import { loginAs, useSeededApp } from '../test/app.ts';
import { errorCode, INSUFFICIENT_PRIVILEGE, onlyRow } from '../test/database.ts';
import { parseDatabaseUrl } from './connection.ts';
import * as schema from './schema.ts';

const { app, owner, api } = useSeededApp();

// The seed has no match runs and no Helios availability. Made through the API, they give every
// table rows of both organisations, so a query that sees only one is the policy at work.
beforeAll(async () => {
  const made = await Promise.all([
    (await loginAs(app, 'artemis', 'sam@artemis.example')).post('/v1/missions/MSN-7/match'),
    (await loginAs(app, 'helios', 'farid@helios.example')).post('/v1/missions/MSN-2/match'),
    (await loginAs(app, 'helios', 'ines@helios.example')).post('/v1/crew/CRW-1/availability', { from: '2027-08-02', to: '2027-08-06' }),
  ]);
  expect(made.map((response) => response.ok)).toEqual([true, true, true]);
});

/** Every table, with the column that says which organisation a row belongs to. */
const tables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => {
    const columns = getTableConfig(table).columns.map((column) => column.name);
    return { name: getTableName(table), orgColumn: columns.includes('org_id') ? 'org_id' : 'id' };
  });

const orgId = async (slug: string) =>
  (await onlyRow(owner<{ id: string }[]>`SELECT id FROM organisations WHERE slug = ${slug}`, 'organisation')).id;

/** The organisations whose rows a query on `table` returns. */
const orgsSeenIn = async (sql: Sql | TransactionSql, table: { name: string; orgColumn: string }) =>
  (await sql<{ org: string }[]>`SELECT DISTINCT ${sql(table.orgColumn)} AS org FROM ${sql(table.name)}`).map((row) => row.org);

/** Runs `work` as the API role, in one transaction with `app.org_id` set, as a request does. */
const asTenant = <T>(org: string, work: (sql: TransactionSql) => Promise<T>) =>
  api.client.begin(async (sql) => {
    await sql`SELECT set_config('app.org_id', ${org}, true)`;
    return work(sql);
  });

describe('every table', () => {
  it('has row-level security enabled and forced, under one policy for every role', async () => {
    const found = await owner<{ name: string; enabled: boolean; forced: boolean; policies: string[] }[]>`
      SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             coalesce(array_agg(p.policyname || ' ' || p.cmd || ' ' || array_to_string(p.roles, ',')) FILTER (WHERE p.policyname IS NOT NULL), '{}') AS policies
      FROM pg_class c
      LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ${owner(tables.map((table) => table.name))}
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity`;
    expect(found.sort((a, b) => a.name.localeCompare(b.name))).toEqual(
      tables
        .map(({ name }) => ({ name, enabled: true, forced: true, policies: ['tenant_isolation ALL public'] }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
});

describe('a direct query as the API role', () => {
  it('sees only the organisation whose app.org_id is set, in every table', async () => {
    const [artemis, helios] = [await orgId('artemis'), await orgId('helios')];
    for (const table of tables) {
      expect((await orgsSeenIn(owner, table)).sort(), table.name).toEqual([artemis, helios].sort());
      expect(await asTenant(helios, (sql) => orgsSeenIn(sql, table)), table.name).toEqual([helios]);
      expect(await asTenant(artemis, (sql) => orgsSeenIn(sql, table)), table.name).toEqual([artemis]);
    }
  });

  it('sees no rows at all when no organisation is set, even on a connection that had one set before', async () => {
    const helios = await orgId('helios');
    const connection = await api.client.reserve();
    try {
      for (const table of tables) expect(await orgsSeenIn(connection, table), table.name).toEqual([]);
      // A statement on its own is a transaction of its own, so this setting ends with it, and leaves
      // the connection with an empty one rather than none.
      await connection`SELECT set_config('app.org_id', ${helios}, true)`;
      for (const table of tables) expect(await orgsSeenIn(connection, table), table.name).toEqual([]);
    } finally {
      connection.release();
    }
  });

  it('cannot add, change or delete another organisation\'s rows', async () => {
    const [artemis, helios] = [await orgId('artemis'), await orgId('helios')];
    const artemisSkills = () => owner`SELECT name, category FROM skills WHERE org_id = ${artemis} ORDER BY name`;
    const before = await artemisSkills();

    expect(
      await errorCode(asTenant(helios, (sql) => sql`INSERT INTO skills (org_id, name, category) VALUES (${artemis}, 'stowaway', 'crew')`)),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCode(asTenant(helios, (sql) => sql`UPDATE skills SET org_id = ${artemis} WHERE org_id = ${helios}`))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    const changed = await asTenant(helios, async (sql) => [
      (await sql`UPDATE skills SET category = 'rewritten' WHERE org_id = ${artemis}`).count,
      (await sql`DELETE FROM crew_skills WHERE org_id = ${artemis}`).count,
    ]);
    expect(changed).toEqual([0, 0]);
    expect(await artemisSkills()).toEqual(before);
  });

  it('still finds any organisation\'s user at login, through the one privileged lookup', async () => {
    const found = await onlyRow(api.client`SELECT user_id, org_id FROM auth_find_user('helios', 'farid@helios.example')`, 'user');
    const farid = await onlyRow(owner`SELECT id, org_id FROM users WHERE email = 'farid@helios.example'`, 'user');
    expect(found).toEqual({ user_id: farid.id, org_id: farid.org_id });
  });
});

describe('the owner database role', () => {
  it('is not a superuser but bypasses row-level security, so the seed and the login lookup see every organisation', async () => {
    const { role } = parseDatabaseUrl(requireEnv('TEST_DATABASE_OWNER_URL'));
    const [current] = await owner`
      SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(current).toEqual({ name: role, rolsuper: false, rolbypassrls: true });
  });
});
