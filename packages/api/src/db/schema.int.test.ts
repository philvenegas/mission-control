import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAsApi,
  connectAsOwner,
  errorCode,
  EXCLUSION_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
} from '../test/database.ts';
import { parseDatabaseUrl } from './connection.ts';
import * as t from './schema.ts';
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

describe('one organisation cannot reference another', () => {
  it('rejects a row that links to another organisation\'s row', async () => {
    const helios = await orgId('helios');
    const [dana] = await sql`SELECT id FROM users WHERE email = 'dana@artemis.example'`;
    const [artemisMission] = await sql`SELECT id FROM missions WHERE name = 'Io Flyby'`;
    const [heliosSkill] = await sql`SELECT id FROM skills WHERE org_id = ${helios} AND name = 'robotics'`;
    const [heliosLead] = await sql`SELECT id FROM users WHERE email = 'farid@helios.example'`;

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
    const mission = (owner: string) =>
      sql`INSERT INTO missions (org_id, ref, name, period, owner_id) VALUES (${helios}, 99, 'Probe', '[2028-01-01,2028-01-10)', ${owner})`;
    expect(await errorCode(mission(dana!.id))).toBe(FOREIGN_KEY_VIOLATION);
    expect(await errorCode(mission(heliosLead!.id))).toBeNull();
  });

  it('has org_id, and a composite key to reference, on every table', async () => {
    const tables = await sql`
      SELECT c.relname AS name,
             EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id') AS has_org_id
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'organisations'`;
    expect(tables.length).toBe(11);
    expect(tables.filter((table) => !table.has_org_id)).toEqual([]);

    // Every foreign key between tenant tables includes org_id on both sides.
    const foreignKeys = await sql`
      SELECT conname AS name, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`;
    const single = foreignKeys.filter((key) => !/^FOREIGN KEY \(org_id, \w+\) REFERENCES \w+\(org_id, id\)$/.test(key.definition));
    expect(single.map((key) => key.definition)).toEqual(
      Array(11).fill('FOREIGN KEY (org_id) REFERENCES organisations(id)'),
    );
  });
});

describe('the booking rule', () => {
  const assignment = async (crew: string, mission: string, status: string, ref: number) => {
    const [m] = await sql`SELECT id, org_id, period, owner_id FROM missions WHERE name = ${mission}`;
    const [requirement] = await sql`SELECT id FROM mission_requirements WHERE mission_id = ${m!.id} LIMIT 1`;
    const [member] = await sql`SELECT id FROM crew_members WHERE name = ${crew}`;
    return sql`
      INSERT INTO assignments (org_id, ref, mission_id, requirement_id, crew_member_id, period, status, created_by)
      VALUES (${m!.org_id}, ${ref}, ${m!.id}, ${requirement!.id}, ${member!.id}, ${m!.period}, ${status}, ${m!.owner_id})`;
  };

  it('lets two drafts propose the same crew member for overlapping periods', async () => {
    const proposals = await sql`
      SELECT m.name FROM assignments a
      JOIN missions m ON m.id = a.mission_id JOIN crew_members c ON c.id = a.crew_member_id
      WHERE c.name = 'Ada Reyes' AND a.status = 'proposed' ORDER BY m.ref`;
    expect(proposals.map((row) => row.name)).toEqual(['Ceres Resupply', 'Vesta Mapping']);
  });

  it('refuses a second live assignment that overlaps, whatever the application does', async () => {
    // Quin is held by Phobos Survey for June; Io Flyby is 7–21 June.
    expect(await errorCode(assignment('Quin Abara', 'Io Flyby', 'held', 901))).toBe(EXCLUSION_VIOLATION);
    expect(await errorCode(assignment('Quin Abara', 'Io Flyby', 'offered', 902))).toBe(EXCLUSION_VIOLATION);
    expect(await errorCode(assignment('Quin Abara', 'Io Flyby', 'proposed', 903))).toBeNull();
    // Titan Relay is in April and does not overlap.
    expect(await errorCode(assignment('Quin Abara', 'Titan Relay', 'held', 904))).toBeNull();
  });
});

describe('the API database role', () => {
  it('is not a superuser, cannot bypass row-level security and owns no table', async () => {
    const { role } = parseDatabaseUrl(process.env.TEST_DATABASE_URL!);
    const [current] = await api.client`
      SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(current).toEqual({ name: role, rolsuper: false, rolbypassrls: false });
    const owned = await api.client`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    expect(owned).toEqual([]);
  });

  it('can read and write rows but cannot change or wipe tables', async () => {
    expect((await api.db.select().from(t.organisations)).length).toBe(2);
    expect(await errorCode(api.client`UPDATE skills SET category = category`)).toBeNull();
    expect(await errorCode(api.client`TRUNCATE mission_events`)).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await errorCode(api.client`ALTER TABLE assignments DROP CONSTRAINT no_double_booking`)).toBe(INSUFFICIENT_PRIVILEGE);
  });
});
