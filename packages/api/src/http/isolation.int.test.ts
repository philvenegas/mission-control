import {
  availabilityBlockSchema,
  crewAssignmentSchema,
  matchRunSchema,
  missionSchema,
  type MissionStatus,
} from '@mission-control/contract';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bodyOf, type Caller, loginAs, useSeededApp } from '../test/app.ts';
import { type ArrangedCrew, arrangeLogin, arrangeMission, dayAfter } from '../test/arrange.ts';
import { routeKey } from './route.ts';

const { app, owner } = useSeededApp();

/** What a `Caller` method gives. */
type Answer = ReturnType<Caller['get']>;

interface SweepEntry {
  /** Who calls the route: a director, unless only a crew member may. */
  as?: 'crew_member';
  /** How the caller calls the route on their own organisation's records. It must succeed. */
  call: (caller: Caller, own: OwnRecords) => Answer;
  /**
   * How a Helios Labs caller of the same role calls it naming Artemis records that Helios Labs
   * does not have, at least one call per record the path names. Each must answer 404. Required for
   * every route whose path names a record.
   */
  intoArtemis?: ((heliosCaller: Caller) => Answer)[];
}

/** A record of each kind the caller's own organisation has. */
interface OwnRecords {
  crewMember: string;
  skill: string;
  /** A name for a new crew member, distinct from anything the other organisation has. */
  recruit: string;
  /** A seeded draft. */
  draft: string;
  /** The organisation's slug, for arranging a mission in a given status. */
  slug: string;
  /** A mission lead's email, to own an arranged mission. */
  missionLead: string;
  /** A crew member who holds `skill`. */
  skilledCrewMember: string;
  /** The crew member who logs in as the organisation's sweeping crew member. */
  loggedInCrewMember: string;
}

// Artemis has CRW-9 to CRW-12, AVL-1 to AVL-3, MSN-3 to MSN-7, ASG-5 to ASG-13 and a pilot skill;
// Helios Labs has none of them. RUN-1 is made for Artemis before the first crossing.
const ARTEMIS_ONLY = {
  crewMember: 'CRW-12',
  availabilityBlock: 'AVL-1',
  skill: 'pilot',
  mission: 'MSN-7',
  assignment: 'ASG-13',
  matchRun: 'RUN-1',
};

let arranged = 0;

/**
 * A mission of the caller's organisation in the given status, owned and submitted by its mission
 * lead and needing one of its own skills, so that each transition's guard holds: an approved one
 * has its slot accepted by the caller's own crew member. Each is on its own day of 2031.
 */
function missionIn(own: OwnRecords, status: MissionStatus, crew?: ArrangedCrew[]) {
  const index = arranged++;
  return arrangeMission(owner, {
    org: own.slug,
    name: `Sweep ${own.slug} ${index}`,
    period: dayAfter('2031-01-01', index),
    status,
    owner: own.missionLead,
    skill: own.skill,
    crew: crew ?? (status === 'approved' ? [{ crewMember: own.crewMember, status: 'accepted' }] : []),
  });
}

/** A new match run for a mission, as the caller makes it. */
async function matchRunFor(director: Caller, missionRef: string) {
  return (await bodyOf(await director.post(`/v1/missions/${missionRef}/match`), matchRunSchema)).ref;
}

/** The one assignment on a mission with one slot. */
async function onlyAssignmentOn(director: Caller, missionRef: string) {
  const { requirements } = await bodyOf(await director.get(`/v1/missions/${missionRef}`), missionSchema);
  const [assignment] = requirements.flatMap(({ crew }) => crew);
  if (!assignment) throw new Error(`${missionRef} has no crew`);
  return assignment.assignment;
}

/** The caller's own offer on a mission. */
async function offerOn(crewMember: Caller, missionRef: string) {
  const offer = (await bodyOf(await crewMember.get('/v1/assignments'), z.array(crewAssignmentSchema))).find(
    (assignment) => assignment.mission.ref === missionRef,
  );
  if (!offer) throw new Error(`No offer on ${missionRef}`);
  return offer.ref;
}

/**
 * The isolation sweep. Every route that acts as a logged-in user is listed here; the coverage test
 * below fails when a registered route is missing. Each is called by a director of each
 * organisation, and the answer must hold nothing of the other organisation and no internal id.
 */
const SWEEP_ENTRIES: [string, SweepEntry][] = [
  ['GET /v1/me', { call: (director) => director.get('/v1/me') }],
  ['GET /v1/org', { call: (director) => director.get('/v1/org') }],
  ['GET /v1/skills', { call: (director) => director.get('/v1/skills') }],
  ['GET /v1/crew', { call: (director) => director.get('/v1/crew') }],
  ['POST /v1/crew', { call: (director, own) => director.post('/v1/crew', { name: own.recruit }) }],
  [
    'GET /v1/crew/:ref',
    { call: (director, own) => director.get(`/v1/crew/${own.crewMember}`), intoArtemis: [(helios) => helios.get(`/v1/crew/${ARTEMIS_ONLY.crewMember}`)] },
  ],
  [
    'PATCH /v1/crew/:ref',
    {
      call: (director, own) => director.patch(`/v1/crew/${own.crewMember}`, { status: 'active' }),
      intoArtemis: [(helios) => helios.patch(`/v1/crew/${ARTEMIS_ONLY.crewMember}`, { name: 'Taken' })],
    },
  ],
  [
    'PUT /v1/crew/:ref/skills/:skill',
    {
      call: (director, own) => director.put(`/v1/crew/${own.crewMember}/skills/${own.skill}`, { level: 3 }),
      intoArtemis: [
        // An Artemis crew member, with a skill Helios Labs has.
        (helios) => helios.put(`/v1/crew/${ARTEMIS_ONLY.crewMember}/skills/EVA`, { level: 3 }),
        // Helios Labs' own crew member, with a skill only Artemis has.
        (helios) => helios.put(`/v1/crew/CRW-1/skills/${ARTEMIS_ONLY.skill}`, { level: 3 }),
      ],
    },
  ],
  [
    'DELETE /v1/crew/:ref/skills/:skill',
    {
      call: async (director, own) => {
        await director.put(`/v1/crew/${own.crewMember}/skills/${own.skill}`, { level: 3 });
        return director.delete(`/v1/crew/${own.crewMember}/skills/${own.skill}`);
      },
      intoArtemis: [
        (helios) => helios.delete(`/v1/crew/${ARTEMIS_ONLY.crewMember}/skills/EVA`),
        (helios) => helios.delete(`/v1/crew/CRW-1/skills/${ARTEMIS_ONLY.skill}`),
      ],
    },
  ],
  [
    'GET /v1/crew/:ref/availability',
    {
      call: (director, own) => director.get(`/v1/crew/${own.crewMember}/availability`),
      intoArtemis: [(helios) => helios.get(`/v1/crew/${ARTEMIS_ONLY.crewMember}/availability`)],
    },
  ],
  [
    'POST /v1/crew/:ref/availability',
    {
      call: (director, own) => director.post(`/v1/crew/${own.crewMember}/availability`, { from: '2028-01-03', to: '2028-01-05' }),
      intoArtemis: [(helios) => helios.post(`/v1/crew/${ARTEMIS_ONLY.crewMember}/availability`, { from: '2028-01-03', to: '2028-01-05' })],
    },
  ],
  [
    'DELETE /v1/availability/:ref',
    {
      call: async (director, own) => {
        const created = await director.post(`/v1/crew/${own.crewMember}/availability`, { from: '2028-02-01', to: '2028-02-02' });
        const { ref } = await bodyOf(created, availabilityBlockSchema);
        return director.delete(`/v1/availability/${ref}`);
      },
      intoArtemis: [(helios) => helios.delete(`/v1/availability/${ARTEMIS_ONLY.availabilityBlock}`)],
    },
  ],
  ['GET /v1/missions', { call: (director) => director.get('/v1/missions') }],
  ['POST /v1/missions', { call: (director, own) => director.post('/v1/missions', { name: `${own.recruit}'s mission`, from: '2028-06-01', to: '2028-06-05' }) }],
  [
    'GET /v1/missions/:ref',
    { call: (director, own) => director.get(`/v1/missions/${own.draft}`), intoArtemis: [(helios) => helios.get(`/v1/missions/${ARTEMIS_ONLY.mission}`)] },
  ],
  [
    'PATCH /v1/missions/:ref',
    {
      call: (director, own) => director.patch(`/v1/missions/${own.draft}`, { description: 'Swept.' }),
      intoArtemis: [(helios) => helios.patch(`/v1/missions/${ARTEMIS_ONLY.mission}`, { name: 'Taken' })],
    },
  ],
  [
    'GET /v1/missions/:ref/events',
    {
      call: (director, own) => director.get(`/v1/missions/${own.draft}/events`),
      intoArtemis: [(helios) => helios.get(`/v1/missions/${ARTEMIS_ONLY.mission}/events`)],
    },
  ],
  [
    'PUT /v1/missions/:ref/requirements/:skill',
    {
      call: (director, own) => director.put(`/v1/missions/${own.draft}/requirements/${encodeURIComponent(own.skill)}`, { min_level: 2 }),
      intoArtemis: [
        // An Artemis mission, with a skill Helios Labs has.
        (helios) => helios.put(`/v1/missions/${ARTEMIS_ONLY.mission}/requirements/EVA`, { min_level: 2 }),
        // Helios Labs' own draft, with a skill only Artemis has.
        (helios) => helios.put(`/v1/missions/MSN-2/requirements/${ARTEMIS_ONLY.skill}`, { min_level: 2 }),
      ],
    },
  ],
  [
    'DELETE /v1/missions/:ref/requirements/:skill',
    {
      call: async (director, own) => {
        const draft = await missionIn(own, 'draft');
        return director.delete(`/v1/missions/${draft}/requirements/${encodeURIComponent(own.skill)}`);
      },
      intoArtemis: [
        (helios) => helios.delete(`/v1/missions/${ARTEMIS_ONLY.mission}/requirements/EVA`),
        (helios) => helios.delete(`/v1/missions/MSN-2/requirements/${ARTEMIS_ONLY.skill}`),
      ],
    },
  ],
  [
    'POST /v1/missions/:ref/match',
    {
      call: (director, own) => director.post(`/v1/missions/${own.draft}/match`),
      intoArtemis: [(helios) => helios.post(`/v1/missions/${ARTEMIS_ONLY.mission}/match`)],
    },
  ],
  [
    'GET /v1/match-runs/:ref',
    {
      call: async (director, own) => director.get(`/v1/match-runs/${await matchRunFor(director, own.draft)}`),
      intoArtemis: [(helios) => helios.get(`/v1/match-runs/${ARTEMIS_ONLY.matchRun}`)],
    },
  ],
  [
    'POST /v1/match-runs/:ref/apply',
    {
      call: async (director, own) =>
        director.post(`/v1/match-runs/${await matchRunFor(director, await missionIn(own, 'draft'))}/apply`, { allow_clashes: true }),
      intoArtemis: [(helios) => helios.post(`/v1/match-runs/${ARTEMIS_ONLY.matchRun}/apply`, {})],
    },
  ],
  [
    'POST /v1/missions/:ref/assignments',
    {
      call: async (director, own) =>
        director.post(`/v1/missions/${await missionIn(own, 'draft')}/assignments`, { crew_member: own.skilledCrewMember, skill: own.skill }),
      intoArtemis: [
        // An Artemis mission, with Helios Labs' own crew member and skill.
        (helios) => helios.post(`/v1/missions/${ARTEMIS_ONLY.mission}/assignments`, { crew_member: 'CRW-1', skill: 'EVA' }),
        // Helios Labs' own draft, with an Artemis crew member, then with a skill only Artemis has.
        (helios) => helios.post('/v1/missions/MSN-2/assignments', { crew_member: ARTEMIS_ONLY.crewMember, skill: 'robotics' }),
        (helios) => helios.post('/v1/missions/MSN-2/assignments', { crew_member: 'CRW-7', skill: ARTEMIS_ONLY.skill }),
      ],
    },
  ],
  [
    'DELETE /v1/missions/:ref/assignments',
    {
      call: async (director, own) => director.delete(`/v1/missions/${await missionIn(own, 'draft')}/assignments`),
      intoArtemis: [(helios) => helios.delete(`/v1/missions/${ARTEMIS_ONLY.mission}/assignments`)],
    },
  ],
  [
    'DELETE /v1/assignments/:ref',
    {
      call: async (director, own) => director.delete(`/v1/assignments/${await onlyAssignmentOn(director, await missionIn(own, 'approved'))}`),
      intoArtemis: [(helios) => helios.delete(`/v1/assignments/${ARTEMIS_ONLY.assignment}`)],
    },
  ],
  ['GET /v1/assignments', { as: 'crew_member', call: (crewMember) => crewMember.get('/v1/assignments') }],
  ...(['accept', 'decline'] as const).map((response): [string, SweepEntry] => [
    `POST /v1/assignments/:ref/${response}`,
    {
      as: 'crew_member',
      call: async (crewMember, own) => {
        const missionRef = await missionIn(own, 'approved', [{ crewMember: own.loggedInCrewMember, status: 'offered' }]);
        return crewMember.post(`/v1/assignments/${await offerOn(crewMember, missionRef)}/${response}`, {});
      },
      intoArtemis: [(helios) => helios.post(`/v1/assignments/${ARTEMIS_ONLY.assignment}/${response}`, {})],
    },
  ]),
  ...(
    [
      ['submit', 'draft'],
      ['approve', 'submitted'],
      ['reject', 'submitted'],
      ['launch', 'approved'],
      ['complete', 'active'],
      ['cancel', 'draft'],
    ] as const
  ).map(([transition, from]): [string, SweepEntry] => [
    `POST /v1/missions/:ref/${transition}`,
    {
      call: async (director, own) => director.post(`/v1/missions/${await missionIn(own, from)}/${transition}`, { note: 'Swept.' }),
      intoArtemis: [(helios) => helios.post(`/v1/missions/${ARTEMIS_ONLY.mission}/${transition}`, { note: 'Swept.' })],
    },
  ]),
];
const SWEEP = new Map(SWEEP_ENTRIES);

/** Routes that need no login and so act for no organisation. */
const PUBLIC = ['GET /v1/health', 'POST /v1/auth/login'];

/** The request pipeline itself, which is not a route. */
const PIPELINE = 'ALL /v1/*';

/** Helios Labs seeds no crew logins, so the sweep gives Bao Tran one. */
const HELIOS_CREW_LOGIN = { crewMember: 'CRW-2', email: 'bao@helios.example' };

const ORGANISATIONS = [
  {
    slug: 'artemis',
    director: 'dana@artemis.example',
    crewMemberLogin: 'ada@artemis.example',
    own: {
      crewMember: 'CRW-2',
      skill: 'comms',
      recruit: 'Aster Quill',
      draft: 'MSN-6',
      slug: 'artemis',
      missionLead: 'sam@artemis.example',
      skilledCrewMember: 'CRW-10',
      loggedInCrewMember: 'CRW-1',
    },
    otherSlug: 'helios',
  },
  {
    slug: 'helios',
    director: 'ines@helios.example',
    crewMemberLogin: HELIOS_CREW_LOGIN.email,
    own: {
      crewMember: 'CRW-2',
      skill: 'EVA',
      recruit: 'Helio Brandt',
      draft: 'MSN-2',
      slug: 'helios',
      missionLead: 'farid@helios.example',
      skilledCrewMember: 'CRW-1',
      loggedInCrewMember: HELIOS_CREW_LOGIN.crewMember,
    },
    otherSlug: 'artemis',
  },
];

beforeAll(async () => {
  await arrangeLogin(owner, 'helios', HELIOS_CREW_LOGIN.crewMember, HELIOS_CREW_LOGIN.email);
});

/** Every string value anywhere in a JSON document, lower-cased. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value.toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

/** The other organisation's fingerprints that appear as a value in a response body. */
async function leaked(response: Response, otherSlug: string): Promise<string[]> {
  const text = await response.text();
  const values = new Set(text ? stringsIn(JSON.parse(text)) : []);
  return (await fingerprints(otherSlug)).filter((value) => values.has(value.toLowerCase()));
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Every id, slug, name and email that belongs to one organisation only. */
async function fingerprints(slug: string): Promise<string[]> {
  const rows = await owner`
    WITH org AS (SELECT id, slug, name FROM organisations WHERE slug = ${slug})
    SELECT slug AS value FROM org UNION SELECT name FROM org UNION SELECT id::text FROM org
    UNION SELECT email FROM users WHERE org_id = (SELECT id FROM org)
    UNION SELECT name FROM users WHERE org_id = (SELECT id FROM org)
    UNION SELECT name FROM crew_members WHERE org_id = (SELECT id FROM org)
    UNION SELECT name FROM missions WHERE org_id = (SELECT id FROM org)
    UNION SELECT name FROM skills WHERE org_id = (SELECT id FROM org)`;
  return rows.map((row) => String(row.value));
}

// Runs first, while Helios Labs still has none of the Artemis-only references.
describe('a Helios Labs user naming Artemis records', () => {
  const crossings = [...SWEEP].flatMap(([key, entry]) =>
    (entry.intoArtemis ?? []).map((call, index) => [`${key} (${index + 1})`, entry.as === 'crew_member' ? HELIOS_CREW_LOGIN.email : 'ines@helios.example', call] as const),
  );

  beforeAll(async () => {
    const dana = await loginAs(app, 'artemis', 'dana@artemis.example');
    expect(await matchRunFor(dana, 'MSN-7')).toBe(ARTEMIS_ONLY.matchRun);
  });

  it.each(crossings)('calls %s as %s and is told the record does not exist, and nothing more', async (_, email, call) => {
    const response = await call(await loginAs(app, 'helios', email));
    expect(response.status).toBe(404);
    expect(await response.clone().json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await leaked(response, 'artemis')).toEqual([]);
  });

  it('refuses a role that may not change crew the same way, whether the record exists or not', async () => {
    const farid = await loginAs(app, 'helios', 'farid@helios.example');
    const [artemisOnly, heliosOwn] = [
      await farid.patch(`/v1/crew/${ARTEMIS_ONLY.crewMember}`, { name: 'Taken' }),
      await farid.patch('/v1/crew/CRW-1', { name: 'Taken' }),
    ];
    expect([artemisOnly.status, heliosOwn.status]).toEqual([403, 403]);
    expect(await artemisOnly.json()).toEqual(await heliosOwn.json());
  });

  it('changed nothing of Artemis along the way', async () => {
    const [tala] = await owner`
      SELECT c.name, (SELECT count(*)::int FROM availability_blocks b WHERE b.crew_member_id = c.id) AS blocks,
             (SELECT count(*)::int FROM crew_skills s WHERE s.crew_member_id = c.id) AS skills
      FROM crew_members c JOIN organisations o ON o.id = c.org_id WHERE o.slug = 'artemis' AND c.ref = 12`;
    expect(tala).toEqual({ name: 'Tala Moreno', blocks: 1, skills: 1 });
    const [omar] = await owner`SELECT count(*)::int AS blocks FROM availability_blocks WHERE ref = 1 AND org_id = (SELECT id FROM organisations WHERE slug = 'artemis')`;
    expect(omar).toEqual({ blocks: 1 });
    const [ioFlyby] = await owner`
      SELECT m.name, m.status, (SELECT count(*)::int FROM mission_requirements r WHERE r.mission_id = m.id) AS requirements,
             (SELECT count(*)::int FROM mission_events e WHERE e.mission_id = m.id) AS events
      FROM missions m JOIN organisations o ON o.id = m.org_id WHERE o.slug = 'artemis' AND m.ref = 7`;
    expect(ioFlyby).toEqual({ name: 'Io Flyby', status: 'draft', requirements: 2, events: 0 });
  });
});

describe.each(ORGANISATIONS)('a user of $slug', ({ slug, director, crewMemberLogin, own, otherSlug }) => {
  it.each([...SWEEP])('calls %s and sees nothing of the other organisation, and no internal id', async (_, entry) => {
    const response = await entry.call(await loginAs(app, slug, entry.as === 'crew_member' ? crewMemberLogin : director), own);
    expect(response.status).toBeLessThan(300);
    expect(await response.clone().text()).not.toMatch(UUID);
    expect(await leaked(response, otherSlug)).toEqual([]);
  });
});

describe('the sweep', () => {
  it('covers every registered route, whatever its method', () => {
    const registered = new Set(app.routes.map(routeKey));
    expect([...registered].sort()).toEqual([...SWEEP.keys(), ...PUBLIC, PIPELINE].sort());
  });

  it('crosses into the other organisation once for every record a route\'s path names', () => {
    const naming = [...SWEEP].filter(([key]) => key.includes(':'));
    const uncrossed = naming.filter(([key, entry]) => (entry.intoArtemis ?? []).length < (key.match(/:/g) ?? []).length);
    expect(uncrossed.map(([key]) => key)).toEqual([]);
  });

  it('finds a leak when there is one', async () => {
    expect(await leaked(Response.json({ crew: [{ name: 'Ada Reyes' }] }), 'artemis')).toEqual(['Ada Reyes']);
    expect(await leaked(Response.json({ category: 'field medicine' }), 'artemis')).toEqual([]);
  });

  it("tells the two organisations apart: neither's fingerprints include the other's", async () => {
    const [artemis, helios] = [await fingerprints('artemis'), await fingerprints('helios')];
    expect(artemis).toEqual(expect.arrayContaining(['artemis', 'Artemis', 'dana@artemis.example', 'Ada Reyes', 'Io Flyby', 'pilot']));
    expect(helios).toEqual(expect.arrayContaining(['helios', 'Helios Labs', 'ines@helios.example', 'Anouk Petit', 'Mercury Flyby', 'EVA']));
    expect(artemis.filter((value) => helios.includes(value))).toEqual([]);
  });
});
