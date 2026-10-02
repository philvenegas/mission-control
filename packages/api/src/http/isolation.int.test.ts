import { describe, expect, it } from 'vitest';
import { type Caller, loginAs, useSeededApp } from '../test/app.ts';
import { routeKey } from './route.ts';

const { app, owner } = useSeededApp();

interface SweepEntry {
  /** How a director calls the route on their own organisation's records. It must succeed. */
  call: (director: Caller, own: OwnRecords) => Promise<Response>;
  /**
   * How a Helios Labs director calls it naming Artemis records that Helios Labs does not have.
   * It must answer 404. Required for every route whose path names a record.
   */
  intoArtemis?: (heliosDirector: Caller) => Promise<Response>;
}

/** A record of each kind the caller's own organisation has. */
interface OwnRecords {
  crewMember: string;
  skill: string;
  /** A name for a new crew member, distinct from anything the other organisation has. */
  recruit: string;
}

// Artemis has CRW-9 to CRW-12, AVL-1 to AVL-3 and a pilot skill; Helios Labs has none of them.
const ARTEMIS_ONLY = { crewMember: 'CRW-12', availabilityBlock: 'AVL-1', skill: 'pilot' };

/**
 * The isolation sweep. Every route that acts as a logged-in user is listed here; the coverage test
 * below fails when a registered route is missing. Each is called by a director of each
 * organisation, and the answer must hold nothing of the other organisation and no internal id.
 */
const SWEEP = new Map<string, SweepEntry>(<[string, SweepEntry][]>[
  ['GET /v1/me', { call: (director) => director.get('/v1/me') }],
  ['GET /v1/org', { call: (director) => director.get('/v1/org') }],
  ['GET /v1/skills', { call: (director) => director.get('/v1/skills') }],
  ['GET /v1/crew', { call: (director) => director.get('/v1/crew') }],
  ['POST /v1/crew', { call: (director, own) => director.post('/v1/crew', { name: own.recruit }) }],
  [
    'GET /v1/crew/:ref',
    { call: (director, own) => director.get(`/v1/crew/${own.crewMember}`), intoArtemis: (helios) => helios.get(`/v1/crew/${ARTEMIS_ONLY.crewMember}`) },
  ],
  [
    'PATCH /v1/crew/:ref',
    {
      call: (director, own) => director.patch(`/v1/crew/${own.crewMember}`, { status: 'active' }),
      intoArtemis: (helios) => helios.patch(`/v1/crew/${ARTEMIS_ONLY.crewMember}`, { name: 'Taken' }),
    },
  ],
  [
    'PUT /v1/crew/:ref/skills/:skill',
    {
      call: (director, own) => director.put(`/v1/crew/${own.crewMember}/skills/${own.skill}`, { level: 3 }),
      // Helios Labs' own CRW-1, with a skill only Artemis has.
      intoArtemis: (helios) => helios.put(`/v1/crew/CRW-1/skills/${ARTEMIS_ONLY.skill}`, { level: 3 }),
    },
  ],
  [
    'DELETE /v1/crew/:ref/skills/:skill',
    {
      call: async (director, own) => {
        await director.put(`/v1/crew/${own.crewMember}/skills/${own.skill}`, { level: 3 });
        return director.delete(`/v1/crew/${own.crewMember}/skills/${own.skill}`);
      },
      intoArtemis: (helios) => helios.delete(`/v1/crew/${ARTEMIS_ONLY.crewMember}/skills/${ARTEMIS_ONLY.skill}`),
    },
  ],
  [
    'GET /v1/crew/:ref/availability',
    {
      call: (director, own) => director.get(`/v1/crew/${own.crewMember}/availability`),
      intoArtemis: (helios) => helios.get(`/v1/crew/${ARTEMIS_ONLY.crewMember}/availability`),
    },
  ],
  [
    'POST /v1/crew/:ref/availability',
    {
      call: (director, own) => director.post(`/v1/crew/${own.crewMember}/availability`, { from: '2028-01-03', to: '2028-01-05' }),
      intoArtemis: (helios) => helios.post(`/v1/crew/${ARTEMIS_ONLY.crewMember}/availability`, { from: '2028-01-03', to: '2028-01-05' }),
    },
  ],
  [
    'DELETE /v1/availability/:ref',
    {
      call: async (director, own) => {
        const created = await director.post(`/v1/crew/${own.crewMember}/availability`, { from: '2028-02-01', to: '2028-02-02' });
        const { ref } = (await created.json()) as { ref: string };
        return director.delete(`/v1/availability/${ref}`);
      },
      intoArtemis: (helios) => helios.delete(`/v1/availability/${ARTEMIS_ONLY.availabilityBlock}`),
    },
  ],
]);

/** Routes that need no login and so act for no organisation. */
const PUBLIC = ['GET /v1/health', 'POST /v1/auth/login'];

/** The request pipeline itself, which is not a route. */
const PIPELINE = 'ALL /v1/*';

const ORGANISATIONS = [
  { slug: 'artemis', director: 'dana@artemis.example', own: { crewMember: 'CRW-2', skill: 'comms', recruit: 'Aster Quill' }, otherSlug: 'helios' },
  { slug: 'helios', director: 'ines@helios.example', own: { crewMember: 'CRW-2', skill: 'EVA', recruit: 'Helio Brandt' }, otherSlug: 'artemis' },
];

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
describe('a Helios Labs director naming Artemis records', () => {
  const crossing = [...SWEEP].filter(([, entry]) => entry.intoArtemis);

  it.each(crossing)('calls %s and is told they do not exist', async (_, entry) => {
    const response = await entry.intoArtemis!(await loginAs(app, 'helios', 'ines@helios.example'));
    expect(response.status).toBe(404);
  });

  it('changed nothing of Artemis along the way', async () => {
    const [tala] = await owner`
      SELECT c.name, (SELECT count(*)::int FROM availability_blocks b WHERE b.crew_member_id = c.id) AS blocks,
             (SELECT count(*)::int FROM crew_skills s WHERE s.crew_member_id = c.id) AS skills
      FROM crew_members c JOIN organisations o ON o.id = c.org_id WHERE o.slug = 'artemis' AND c.ref = 12`;
    expect(tala).toEqual({ name: 'Tala Moreno', blocks: 1, skills: 1 });
    const [omar] = await owner`SELECT count(*)::int AS blocks FROM availability_blocks WHERE ref = 1 AND org_id = (SELECT id FROM organisations WHERE slug = 'artemis')`;
    expect(omar).toEqual({ blocks: 1 });
  });
});

describe.each(ORGANISATIONS)('a director of $slug', ({ slug, director, own, otherSlug }) => {
  it.each([...SWEEP])('calls %s and sees nothing of the other organisation, and no internal id', async (_, entry) => {
    const response = await entry.call(await loginAs(app, slug, director), own);
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

  it('crosses into the other organisation on every route whose path names a record', () => {
    const naming = [...SWEEP].filter(([key]) => key.includes(':'));
    expect(naming.filter(([, entry]) => !entry.intoArtemis).map(([key]) => key)).toEqual([]);
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
