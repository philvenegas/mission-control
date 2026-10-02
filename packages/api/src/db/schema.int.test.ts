import { DEFAULT_ORG_SETTINGS, LIVE_ASSIGNMENT_STATUSES } from '@mission-control/contract';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireEnv } from '../env.ts';
import {
  CHECK_VIOLATION,
  connectAsApi,
  connectAsOwner,
  errorCode,
  EXCLUSION_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
} from '../test/database.ts';
import { parseDatabaseUrl } from './connection.ts';
import * as schema from './schema.ts';
import { seed } from './seed.ts';

const owner = connectAsOwner();
const api = connectAsApi();
const sql = owner.client;

beforeAll(async () => {
  await seed(owner.db);
});
afterAll(async () => {
  await Promise.all([owner.client.end(), api.client.end()]);
});

const orgId = async (slug: string) => (await sql`SELECT id FROM organisations WHERE slug = ${slug}`)[0]!.id as string;

/** An assignment of a crew member to a mission, in a slot of the mission named by `requirementOf`. */
const assign = async (
  crewMemberName: string,
  missionName: string,
  status: string,
  ref: number,
  { requirementOf = missionName, period }: { requirementOf?: string; period?: string } = {},
) => {
  const [mission] = await sql`SELECT id, org_id, period::text, owner_id FROM missions WHERE name = ${missionName}`;
  const [requirement] = await sql`
    SELECT r.id FROM mission_requirements r JOIN missions m ON m.id = r.mission_id WHERE m.name = ${requirementOf} LIMIT 1`;
  const [crewMember] = await sql`SELECT id FROM crew_members WHERE name = ${crewMemberName}`;
  return sql`
    INSERT INTO assignments (org_id, ref, mission_id, requirement_id, crew_member_id, period, status, created_by)
    VALUES (${mission!.org_id}, ${ref}, ${mission!.id}, ${requirement!.id}, ${crewMember!.id},
            ${period ?? mission!.period}, ${status}, ${mission!.owner_id})`;
};

describe('one organisation cannot reference another', () => {
  it('rejects a row that links to another organisation\'s row', async () => {
    const helios = await orgId('helios');
    const [dana] = await sql`SELECT id FROM users WHERE email = 'dana@artemis.example'`;
    const [artemisMission] = await sql`SELECT id FROM missions WHERE name = 'Io Flyby'`;
    const [heliosSkill] = await sql`SELECT id FROM skills WHERE org_id = ${helios} AND name = 'robotics'`;
    const [farid] = await sql`SELECT id FROM users WHERE email = 'farid@helios.example'`;

    // A Helios crew member linked to an Artemis user.
    expect(
      await errorCode(sql`INSERT INTO crew_members (org_id, ref, name, user_id) VALUES (${helios}, 99, 'Intruder', ${dana!.id})`),
    ).toBe(FOREIGN_KEY_VIOLATION);
    // A Helios requirement on an Artemis mission.
    expect(
      await errorCode(
        sql`INSERT INTO mission_requirements (org_id, mission_id, skill_id, min_level) VALUES (${helios}, ${artemisMission!.id}, ${heliosSkill!.id}, 3)`,
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    // A Helios mission owned by an Artemis user; the same mission with a Helios owner is fine.
    const mission = (ownerId: string) =>
      sql`INSERT INTO missions (org_id, ref, name, period, owner_id) VALUES (${helios}, 99, 'Probe', '[2028-01-01,2028-01-10)', ${ownerId})`;
    expect(await errorCode(mission(dana!.id))).toBe(FOREIGN_KEY_VIOLATION);
    expect(await errorCode(mission(farid!.id))).toBeNull();
  });

  it('has org_id on every table, and org_id in every foreign key', async () => {
    const tenantTables = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .map((table) => getTableName(table))
      .filter((name) => name !== 'organisations')
      .sort();
    const withOrgId = await sql`
      SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id'
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;
    expect(withOrgId.map((table) => table.name)).toEqual(tenantTables);

    // Each tenant table points at its organisation; every other foreign key starts with org_id on both sides.
    const foreignKeys = await sql`
      SELECT conrelid::regclass::text AS "table", pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`;
    const toOrganisation = 'FOREIGN KEY (org_id) REFERENCES organisations(id)';
    expect(foreignKeys.filter((key) => key.definition === toOrganisation).map((key) => key.table).sort()).toEqual(tenantTables);
    const betweenTenantTables = foreignKeys.filter((key) => key.definition !== toOrganisation);
    expect(betweenTenantTables.length).toBeGreaterThan(0);
    expect(
      betweenTenantTables.filter((key) => !/^FOREIGN KEY \(org_id, [\w, ]+\) REFERENCES \w+\(org_id, [\w, ]+\)/.test(key.definition)),
    ).toEqual([]);
  });
});

describe('the booking rule', () => {
  it('lets two drafts propose the same crew member for overlapping periods', async () => {
    const proposals = await sql`
      SELECT m.name FROM assignments a
      JOIN missions m ON m.id = a.mission_id JOIN crew_members c ON c.id = a.crew_member_id
      WHERE c.name = 'Ada Reyes' AND a.status = 'proposed' ORDER BY m.ref`;
    expect(proposals.map((row) => row.name)).toEqual(['Ceres Resupply', 'Vesta Mapping']);
  });

  it('refuses a second live assignment that overlaps, whatever the application does', async () => {
    // Quin is held by Phobos Survey for June; Io Flyby is 7–21 June.
    expect(await errorCode(assign('Quin Abara', 'Io Flyby', 'held', 901))).toBe(EXCLUSION_VIOLATION);
    expect(await errorCode(assign('Quin Abara', 'Io Flyby', 'offered', 902))).toBe(EXCLUSION_VIOLATION);
    expect(await errorCode(assign('Quin Abara', 'Io Flyby', 'accepted', 903))).toBe(EXCLUSION_VIOLATION);
    expect(await errorCode(assign('Quin Abara', 'Io Flyby', 'proposed', 904))).toBeNull();
    // Titan Relay is in April and does not overlap.
    expect(await errorCode(assign('Quin Abara', 'Titan Relay', 'held', 905))).toBeNull();
  });

  it('covers exactly the statuses the contract calls live', async () => {
    const [rule] = await sql`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'no_double_booking'`;
    const predicate = rule!.definition.slice(rule!.definition.indexOf('WHERE'));
    expect([...predicate.matchAll(/'(\w+)'/g)].map((match) => match[1])).toEqual([...LIVE_ASSIGNMENT_STATUSES]);
  });
});

describe('an assignment belongs to one mission', () => {
  it('refuses a requirement that belongs to another mission', async () => {
    expect(await errorCode(assign('Ben Osei', 'Io Flyby', 'proposed', 911, { requirementOf: 'Titan Relay' }))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('refuses a period that differs from its mission\'s', async () => {
    expect(await errorCode(assign('Ben Osei', 'Io Flyby', 'proposed', 912, { period: '[2027-06-07,2027-06-20)' }))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('follows its mission when the mission\'s period changes', async () => {
    await sql`UPDATE missions SET period = '[2027-05-04,2027-05-25)' WHERE name = 'Ceres Resupply'`;
    const periods = await sql`
      SELECT DISTINCT a.period::text FROM assignments a JOIN missions m ON m.id = a.mission_id WHERE m.name = 'Ceres Resupply'`;
    expect(periods.map((row) => row.period)).toEqual(['[2027-05-04,2027-05-25)']);
  });

  it('refuses a period change that would double-book a held crew member', async () => {
    // Moving Phobos Survey onto April would overlap the Titan Relay hold on Quin taken above.
    expect(
      await errorCode(sql`UPDATE missions SET period = '[2027-04-10,2027-04-20)' WHERE name = 'Phobos Survey'`),
    ).toBe(EXCLUSION_VIOLATION);
  });
});

describe('values the database checks', () => {
  it('refuses a status, role, level or event type outside the contract', async () => {
    const artemis = await orgId('artemis');
    const [mission] = await sql`SELECT id, owner_id FROM missions WHERE name = 'Io Flyby'`;
    expect(await errorCode(sql`UPDATE missions SET status = 'paused' WHERE id = ${mission!.id}`)).toBe(CHECK_VIOLATION);
    expect(await errorCode(sql`UPDATE users SET role = 'admin' WHERE org_id = ${artemis}`)).toBe(CHECK_VIOLATION);
    expect(await errorCode(sql`UPDATE crew_members SET status = 'retired' WHERE org_id = ${artemis}`)).toBe(CHECK_VIOLATION);
    expect(await errorCode(sql`UPDATE crew_skills SET level = 6 WHERE org_id = ${artemis}`)).toBe(CHECK_VIOLATION);
    expect(await errorCode(sql`UPDATE mission_requirements SET min_level = 0 WHERE org_id = ${artemis}`)).toBe(CHECK_VIOLATION);
    expect(await errorCode(sql`UPDATE mission_requirements SET headcount = 0 WHERE org_id = ${artemis}`)).toBe(CHECK_VIOLATION);
    expect(await errorCode(sql`UPDATE assignments SET status = 'pending' WHERE org_id = ${artemis}`)).toBe(CHECK_VIOLATION);
    expect(await errorCode(sql`UPDATE mission_approvals SET decision = 'abstain' WHERE org_id = ${artemis}`)).toBe(CHECK_VIOLATION);
    const event = (type: string) =>
      sql`INSERT INTO mission_events (org_id, mission_id, actor_id, type) VALUES (${artemis}, ${mission!.id}, ${mission!.owner_id}, ${type})`;
    expect(await errorCode(event('teleport'))).toBe(CHECK_VIOLATION);
    expect(await errorCode(event('clash'))).toBeNull();
  });

  it('refuses an empty period', async () => {
    expect(await errorCode(sql`UPDATE missions SET period = 'empty' WHERE name = 'Io Flyby'`)).toBe(CHECK_VIOLATION);
    expect(await errorCode(sql`UPDATE availability_blocks SET period = '[2027-03-05,2027-03-05)'`)).toBe(CHECK_VIOLATION);
  });

  it('gives a new organisation the default settings', async () => {
    const [org] = await sql`INSERT INTO organisations (name, slug) VALUES ('Default Org', 'default-org') RETURNING settings`;
    expect(org!.settings).toEqual(DEFAULT_ORG_SETTINGS);
  });
});

describe('the API database role', () => {
  it('is not a superuser, cannot bypass row-level security and owns no table', async () => {
    const { role } = parseDatabaseUrl(requireEnv('TEST_DATABASE_URL'));
    const [current] = await api.client`
      SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(current).toEqual({ name: role, rolsuper: false, rolbypassrls: false });
    const owned = await api.client`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    expect(owned).toEqual([]);
  });

  it('can read and write rows but cannot change or wipe tables', async () => {
    expect((await api.db.select().from(schema.organisations)).length).toBeGreaterThanOrEqual(2);
    expect(await errorCode(api.client`UPDATE skills SET category = category`)).toBeNull();
    expect(await errorCode(api.client`TRUNCATE skills`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCode(api.client`ALTER TABLE assignments DROP CONSTRAINT no_double_booking`)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('can add to a mission\'s history and approvals but never rewrite them', async () => {
    const [mission] = await sql`SELECT id, org_id, owner_id FROM missions WHERE name = 'Phobos Survey'`;
    expect(
      await errorCode(
        api.client`INSERT INTO mission_events (org_id, mission_id, actor_id, type) VALUES (${mission!.org_id}, ${mission!.id}, ${mission!.owner_id}, 'clash')`,
      ),
    ).toBeNull();
    for (const table of ['mission_events', 'mission_approvals']) {
      expect(await errorCode(api.client`UPDATE ${api.client(table)} SET note = 'rewritten'`)).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await errorCode(api.client`DELETE FROM ${api.client(table)}`)).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('can take an organisation\'s next reference number but cannot create or delete an organisation', async () => {
    expect(await errorCode(api.client`UPDATE organisations SET last_mission_ref = last_mission_ref`)).toBeNull();
    expect(await errorCode(api.client`INSERT INTO organisations (name, slug) VALUES ('Rogue', 'rogue')`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCode(api.client`DELETE FROM organisations`)).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
