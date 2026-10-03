import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../auth/password.ts';
import { connectAsOwner, onlyRow } from '../test/database.ts';
import { exactlyOne } from './rows.ts';
import { DEMO_PASSWORD } from './seed-data.ts';
import { seed } from './seed.ts';
import { type OrgSeed, SEED_ORGS } from './seed-data.ts';

const { client: sql, db } = connectAsOwner();

beforeAll(async () => {
  await seed(db);
});
afterAll(() => sql.end());

describe('the seed', () => {
  it('builds both organisations with their own settings', async () => {
    const orgs = await sql`SELECT slug, name, settings FROM organisations ORDER BY slug`;
    expect(orgs).toEqual([
      {
        slug: 'artemis',
        name: 'Artemis',
        settings: {
          approvals_required: 1,
          allow_unfilled_submission: false,
          min_rest_days: 0,
          match_weights: { proficiency: 0.45, workload: 0.35, rest: 0.2 },
        },
      },
      {
        slug: 'helios',
        name: 'Helios Labs',
        settings: {
          approvals_required: 2,
          allow_unfilled_submission: true,
          min_rest_days: 0,
          match_weights: { proficiency: 0.6, workload: 0.25, rest: 0.15 },
        },
      },
    ]);
  });

  it('gives each organisation its own people, skills and login emails', async () => {
    const count = async (slug: string) => {
      const [row] = await sql`
        SELECT (SELECT count(*)::int FROM users u WHERE u.org_id = o.id AND role = 'director') AS directors,
               (SELECT count(*)::int FROM users u WHERE u.org_id = o.id AND role = 'mission_lead') AS mission_leads,
               (SELECT count(*)::int FROM crew_members c WHERE c.org_id = o.id) AS crew,
               (SELECT count(*)::int FROM crew_members c WHERE c.org_id = o.id AND user_id IS NOT NULL) AS crew_logins,
               (SELECT count(*)::int FROM skills s WHERE s.org_id = o.id) AS skills
        FROM organisations o WHERE slug = ${slug}`;
      return row;
    };
    expect(await count('artemis')).toEqual({ directors: 2, mission_leads: 2, crew: 12, crew_logins: 3, skills: 6 });
    expect(await count('helios')).toEqual({ directors: 3, mission_leads: 1, crew: 8, crew_logins: 0, skills: 5 });

    const logins = await sql`SELECT email, password_hash FROM users ORDER BY email`;
    expect(logins.map((user) => user.email)).toEqual([
      'ada@artemis.example', 'dana@artemis.example', 'farid@helios.example', 'ines@helios.example',
      'marcus@artemis.example', 'mina@artemis.example', 'priya@artemis.example', 'quin@artemis.example',
      'sam@artemis.example', 'tomas@helios.example', 'yuki@helios.example',
    ]);
    expect(logins.every((user) => verifyPassword(DEMO_PASSWORD, user.password_hash))).toBe(true);
  });

  it('numbers Artemis crew and missions as the design names them', async () => {
    const crew = await sql`
      SELECT c.ref, c.name FROM crew_members c JOIN organisations o ON o.id = c.org_id
      WHERE o.slug = 'artemis' ORDER BY c.ref`;
    expect(crew.map((crewMember) => `CRW-${crewMember.ref} ${crewMember.name}`)).toEqual([
      'CRW-1 Ada Reyes', 'CRW-2 Ben Osei', 'CRW-3 Mina Farouk', 'CRW-4 Noor Haddad', 'CRW-5 Omar Vance',
      'CRW-6 Kira Novak', 'CRW-7 Quin Abara', 'CRW-8 Leo Adeyemi', 'CRW-9 Cy Lindqvist', 'CRW-10 Rosa Imani',
      'CRW-11 Sven Dahl', 'CRW-12 Tala Moreno',
    ]);

    const helios = await sql`
      SELECT m.name, m.period::text FROM missions m JOIN organisations o ON o.id = m.org_id WHERE o.slug = 'helios' ORDER BY m.ref`;
    expect(helios.map((mission) => [mission.name, mission.period])).toEqual([
      ['Solar Corona Probe', '[2027-02-01,2027-02-28)'],
      ['Mercury Flyby', '[2027-04-05,2027-04-26)'],
    ]);

    const missions = await sql`
      SELECT m.ref, m.name, m.status, m.period::text, u.name AS owner,
             (SELECT array_agg(DISTINCT a.status) FROM assignments a WHERE a.mission_id = m.id) AS assignment_statuses
      FROM missions m JOIN organisations o ON o.id = m.org_id JOIN users u ON u.id = m.owner_id
      WHERE o.slug = 'artemis' ORDER BY m.ref`;
    expect(missions.map((m) => [m.ref, m.name, m.status, m.period, m.owner, m.assignment_statuses])).toEqual([
      [1, 'Lunar Gateway Resupply', 'active', '[2026-10-15,2027-02-10)', 'Sam Okafor', ['accepted']],
      [2, 'Mars Relay Repair', 'completed', '[2026-09-01,2026-09-25)', 'Priya Nair', ['accepted']],
      [3, 'Phobos Survey', 'submitted', '[2027-06-01,2027-06-30)', 'Priya Nair', ['held']],
      [4, 'Ceres Resupply', 'draft', '[2027-05-03,2027-05-24)', 'Sam Okafor', ['proposed']],
      [5, 'Vesta Mapping', 'draft', '[2027-05-10,2027-05-31)', 'Priya Nair', ['proposed']],
      [6, 'Titan Relay', 'draft', '[2027-04-04,2027-04-30)', 'Sam Okafor', null],
      [7, 'Io Flyby', 'draft', '[2027-06-07,2027-06-21)', 'Sam Okafor', null],
    ]);
  });

  it('leaves each organisation\'s reference counters at the last number used', async () => {
    const counters = await sql`
      SELECT slug, last_mission_ref, last_crew_member_ref, last_match_run_ref, last_availability_block_ref,
             last_assignment_ref = (SELECT max(ref) FROM assignments a WHERE a.org_id = o.id) AS assignments_match
      FROM organisations o ORDER BY slug`;
    expect(counters).toEqual([
      { slug: 'artemis', last_mission_ref: 7, last_crew_member_ref: 12, last_match_run_ref: 0, last_availability_block_ref: 3, assignments_match: true },
      { slug: 'helios', last_mission_ref: 2, last_crew_member_ref: 8, last_match_run_ref: 0, last_availability_block_ref: 0, assignments_match: true },
    ]);
  });

  it('seeds the availability blocks and the certification the walk-through relies on', async () => {
    const blocks = await sql`
      SELECT b.ref, c.name, b.period::text FROM availability_blocks b JOIN crew_members c ON c.id = b.crew_member_id ORDER BY b.ref`;
    expect(blocks.map((block) => [`AVL-${block.ref}`, block.name, block.period])).toEqual([
      ['AVL-1', 'Omar Vance', '[2027-03-05,2027-03-12)'],
      ['AVL-2', 'Omar Vance', '[2027-06-01,2027-06-30)'],
      ['AVL-3', 'Tala Moreno', '[2027-04-01,2027-04-14)'],
    ]);
    const certified = await sql`
      SELECT c.name, s.name AS skill, cs.certified_until::text FROM crew_skills cs
      JOIN crew_members c ON c.id = cs.crew_member_id JOIN skills s ON s.id = cs.skill_id WHERE cs.certified_until IS NOT NULL`;
    expect([...certified]).toEqual([{ name: 'Noor Haddad', skill: 'medic', certified_until: '2027-03-10' }]);
  });

  it('records history and approvals for missions that have moved on, at times that fit each mission', async () => {
    const history = async (name: string) =>
      (await sql`
        SELECT e.type || ' → ' || e.to_status || ' on ' || to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS step
        FROM mission_events e JOIN missions m ON m.id = e.mission_id
        WHERE m.name = ${name} ORDER BY e.created_at`).map((row) => row.step);
    // Mars Relay Repair ran 1–25 Sep 2026: launched as it started, completed as it ended.
    expect(await history('Mars Relay Repair')).toEqual([
      'submit → submitted on 2026-08-02',
      'approve → approved on 2026-08-03',
      'launch → active on 2026-09-01',
      'complete → completed on 2026-09-25',
    ]);
    // Lunar Gateway Resupply starts after the base date, so its launch is stamped the day before the base date.
    expect(await history('Lunar Gateway Resupply')).toEqual([
      'submit → submitted on 2026-09-15',
      'approve → approved on 2026-09-16',
      'launch → active on 2026-09-30',
    ]);
    expect(await history('Phobos Survey')).toEqual(['submit → submitted on 2026-09-24']);
    // Helios Labs needs two approvals; one is in.
    expect(await history('Solar Corona Probe')).toEqual(['submit → submitted on 2026-09-24', 'approve → submitted on 2026-09-25']);
    expect(await history('Io Flyby')).toEqual([]);
    const [probe] = await sql`
      SELECT m.status, m.submission_no, count(a.id)::int AS approvals FROM missions m
      LEFT JOIN mission_approvals a ON a.mission_id = m.id AND a.submission_no = m.submission_no
      WHERE m.name = 'Solar Corona Probe' GROUP BY m.id`;
    expect(probe).toEqual({ status: 'submitted', submission_no: 1, approvals: 1 });
  });

  it('can be run again, rebuilding the same data', async () => {
    await seed(db);
    const [counts] = await sql`SELECT (SELECT count(*)::int FROM organisations) AS orgs, (SELECT count(*)::int FROM missions) AS missions`;
    expect(counts).toEqual({ orgs: 2, missions: 9 });
  });

  it('refuses to run in production', async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(seed(db)).rejects.toThrow(/refuses to run/);
    } finally {
      process.env.NODE_ENV = before;
    }
    expect(await onlyRow(sql`SELECT count(*)::int AS organisations FROM organisations`, 'count')).toEqual({ organisations: 2 });
  });

  describe('given unsound data', () => {
    const artemis = exactlyOne(SEED_ORGS.filter((org) => org.slug === 'artemis'), 'seeded Artemis');
    const gatewayResupply = exactlyOne(
      artemis.missions.filter((mission) => mission.name === 'Lunar Gateway Resupply'),
      'seeded Lunar Gateway Resupply',
    );
    const withMission = (change: Partial<OrgSeed['missions'][number]>): OrgSeed[] => [
      { ...artemis, missions: [{ ...gatewayResupply, ...change }] },
    ];
    const pilots = (crew: string[], headcount: number) => [{ skill: 'pilot', minLevel: 3, headcount, crew }];

    it.each([
      ['a crew member who is not defined', withMission({ requirements: pilots(['Zed'], 1) }), 'names crew member "Zed"'],
      ['a skill the organisation does not have', withMission({ requirements: [{ skill: 'chef', minLevel: 3 }] }), 'names skill "chef"'],
      ['an owner who is not a user', withMission({ owner: 'Nobody' }), 'names user "Nobody"'],
      ['more crew than slots', withMission({ requirements: pilots(['Ben', 'Cy'], 1) }), '2 crew for 1 pilot slots'],
      ['an active mission nobody approved', withMission({ approvedBy: [] }), 'active with 0 of 1 approvals'],
      ['a submitted mission already fully approved', withMission({ status: 'submitted' }), 'submitted with 1 of 1 approvals'],
      ['a draft with an approval', withMission({ status: 'draft' }), 'draft with 1 of 1 approvals'],
    ])('refuses %s and leaves the existing data untouched', async (_, orgs, message) => {
      await expect(seed(db, orgs)).rejects.toThrow(message);
      const [counts] = await sql`SELECT (SELECT count(*)::int FROM organisations) AS orgs, (SELECT count(*)::int FROM missions) AS missions`;
      expect(counts).toEqual({ orgs: 2, missions: 9 });
    });
  });
});
