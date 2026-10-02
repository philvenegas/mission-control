import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../db/seed.ts';
import { type Caller, loginAs, startTestApp } from '../test/app.ts';
import { connectAsOwner } from '../test/database.ts';

const owner = connectAsOwner();
const api = startTestApp();
const { app } = api;

/**
 * The isolation sweep. Every route that acts as a logged-in user is listed here with how to call
 * it; the coverage test below fails when a registered route is missing. Each is called by a
 * director of one organisation, and the answer must hold nothing of the other organisation.
 */
const SWEEP: Record<string, (as: Caller) => Response | Promise<Response>> = {
  'GET /v1/me': (as) => as.get('/v1/me'),
  'GET /v1/org': (as) => as.get('/v1/org'),
};

/** Routes that need no login and so act for no organisation. */
const PUBLIC = ['GET /v1/health', 'POST /v1/auth/login'];

const DIRECTORS = { artemis: 'dana@artemis.example', helios: 'ines@helios.example' } as const;
type Slug = keyof typeof DIRECTORS;
const other = (slug: Slug): Slug => (slug === 'artemis' ? 'helios' : 'artemis');

/** Every name, email and slug that belongs to one organisation only. */
async function fingerprints(slug: Slug): Promise<string[]> {
  const rows = await owner.client`
    WITH org AS (SELECT id, slug, name FROM organisations WHERE slug = ${slug})
    SELECT slug AS value FROM org UNION SELECT name FROM org
    UNION SELECT email FROM users WHERE org_id = (SELECT id FROM org)
    UNION SELECT name FROM users WHERE org_id = (SELECT id FROM org)
    UNION SELECT name FROM crew_members WHERE org_id = (SELECT id FROM org)
    UNION SELECT name FROM missions WHERE org_id = (SELECT id FROM org)
    UNION SELECT name FROM skills WHERE org_id = (SELECT id FROM org)
    UNION SELECT id::text FROM org`;
  return rows.map((row) => row.value as string);
}

beforeAll(async () => {
  await seed(owner.db);
});
afterAll(async () => {
  await Promise.all([owner.client.end(), api.close()]);
});

describe.each(['artemis', 'helios'] as const)('a director of %s', (slug) => {
  it.each(Object.keys(SWEEP))(`calls %s and sees nothing of the other organisation`, async (route) => {
    const director = await loginAs(app, slug, DIRECTORS[slug]);
    const response = await SWEEP[route]!(director);
    expect(response.status).toBe(200);
    const body = (await response.text()).toLowerCase();
    const leaked = (await fingerprints(other(slug))).filter((value) => body.includes(value.toLowerCase()));
    expect(leaked).toEqual([]);
    // The check can fail: the caller's own organisation is in at least one answer.
    if (route === 'GET /v1/org') expect(body).toContain(slug);
  });
});

describe('the sweep', () => {
  it('covers every registered route', () => {
    const registered = [...new Set(app.routes.filter((route) => route.method !== 'ALL').map((route) => `${route.method} ${route.path}`))];
    expect(registered.sort()).toEqual([...Object.keys(SWEEP), ...PUBLIC].sort());
  });

  it('tells two organisations apart: neither\'s fingerprints include the other\'s', async () => {
    const [artemis, helios] = [await fingerprints('artemis'), await fingerprints('helios')];
    expect(artemis.length).toBeGreaterThan(30);
    expect(helios.length).toBeGreaterThan(20);
    expect(artemis.filter((value) => helios.includes(value))).toEqual([]);
  });
});
