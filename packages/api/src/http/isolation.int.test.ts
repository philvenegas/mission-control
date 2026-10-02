import { describe, expect, it } from 'vitest';
import { type Caller, loginAs, useSeededApp } from '../test/app.ts';
import { routeKey } from './route.ts';

const { app, owner } = useSeededApp();

/**
 * The isolation sweep. Every route that acts as a logged-in user is listed here with how to call
 * it; the coverage test below fails when a registered route is missing. Each is called by a
 * director of one organisation, and the answer must hold nothing of the other organisation.
 */
const SWEEP = new Map<string, (director: Caller) => Response | Promise<Response>>([
  ['GET /v1/me', (director) => director.get('/v1/me')],
  ['GET /v1/org', (director) => director.get('/v1/org')],
]);

/** Routes that need no login and so act for no organisation. */
const PUBLIC = ['GET /v1/health', 'POST /v1/auth/login'];

/** The request pipeline itself, which is not a route. */
const PIPELINE = 'ALL /v1/*';

const ORGANISATIONS = [
  { slug: 'artemis', director: 'dana@artemis.example', otherSlug: 'helios' },
  { slug: 'helios', director: 'ines@helios.example', otherSlug: 'artemis' },
];

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

describe.each(ORGANISATIONS)('a director of $slug', ({ slug, director, otherSlug }) => {
  it.each([...SWEEP])('calls %s and sees nothing of the other organisation', async (_, call) => {
    const response = await call(await loginAs(app, slug, director));
    expect(response.status).toBe(200);
    const body = (await response.text()).toLowerCase();
    expect((await fingerprints(otherSlug)).filter((value) => body.includes(value.toLowerCase()))).toEqual([]);
    // Proof the search can find something: the caller's own organisation is in every answer so far.
    expect(body).toContain(slug);
  });
});

describe('the sweep', () => {
  it('covers every registered route, whatever its method', () => {
    const registered = new Set(app.routes.map(routeKey));
    expect([...registered].sort()).toEqual([...SWEEP.keys(), ...PUBLIC, PIPELINE].sort());
  });

  it("tells the two organisations apart: neither's fingerprints include the other's", async () => {
    const [artemis, helios] = [await fingerprints('artemis'), await fingerprints('helios')];
    expect(artemis).toEqual(expect.arrayContaining(['artemis', 'Artemis', 'dana@artemis.example', 'Ada Reyes', 'Io Flyby', 'pilot']));
    expect(helios).toEqual(expect.arrayContaining(['helios', 'Helios Labs', 'ines@helios.example', 'Anouk Petit', 'Mercury Flyby', 'EVA']));
    expect(artemis.filter((value) => helios.includes(value))).toEqual([]);
  });
});
