import { errorResponseSchema, orgResponseSchema } from '@mission-control/contract';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from '../db/connection.ts';
import { skills } from '../db/schema.ts';
import { seed } from '../db/seed.ts';
import { requireEnv } from '../env.ts';
import { forbidden } from '../errors.ts';
import { type Caller, loginAs, startTestApp } from '../test/app.ts';
import { connectAsOwner } from '../test/database.ts';

const owner = connectAsOwner();
const api = startTestApp();
const { app } = api;

// Probe routes, registered only in this test. They sit behind the same middleware as every real
// route, so they show what a handler's transaction is and what becomes of its writes.
app.get('/v1/probe/transaction', async (c) => {
  const [row] = await c.var.tenant.tx.execute(
    sql`SELECT current_setting('app.org_id', true) AS org_id, current_user AS role, pg_current_xact_id_if_assigned() IS NULL AS read_only`,
  );
  return c.json({ ...row, claims_org_id: c.var.tenant.orgId });
});
app.get('/v1/probe/pilot-category', async (c) => {
  const { tx, orgId } = c.var.tenant;
  const [pilot] = await tx.select({ category: skills.category }).from(skills).where(and(eq(skills.orgId, orgId), eq(skills.name, 'pilot')));
  return c.json(pilot ?? {});
});
app.post('/v1/probe/recategorise/:outcome', async (c) => {
  const { tx, orgId } = c.var.tenant;
  await tx.update(skills).set({ category: 'changed' }).where(and(eq(skills.orgId, orgId), eq(skills.name, 'pilot')));
  const outcome = c.req.param('outcome');
  if (outcome === 'domain-error') throw forbidden('Refused after writing.');
  if (outcome === 'crash') throw new Error('A bug after writing.');
  if (outcome === 'conflict-response') return c.json({ error: { code: 'INVALID_INPUT', message: 'Refused by response.' } }, 409);
  if (outcome === 'bad-sql') await tx.execute(sql`SELECT * FROM no_such_table`);
  return c.json({ category: 'changed' });
});

let sam: Caller;
let dana: Caller;
const pilotCategory = async () => ((await (await sam.get('/v1/probe/pilot-category')).json()) as { category: string }).category;

beforeAll(async () => {
  await seed(owner.db);
  sam = await loginAs(app, 'artemis', 'sam@artemis.example');
  dana = await loginAs(app, 'artemis', 'dana@artemis.example');
});
afterAll(async () => {
  await Promise.all([owner.client.end(), api.close()]);
});

describe('a request\'s transaction', () => {
  it('runs as the API database role with the token\'s organisation set', async () => {
    const probe = (await (await sam.get('/v1/probe/transaction')).json()) as Record<string, string>;
    const [artemis] = await owner.client`SELECT id FROM organisations WHERE slug = 'artemis'`;
    expect(probe.org_id).toBe(artemis!.id);
    expect(probe.claims_org_id).toBe(artemis!.id);
    expect(probe.role).toBe(parseDatabaseUrl(requireEnv('TEST_DATABASE_URL')).role);
  });

  it('sets a different organisation for a different organisation\'s user', async () => {
    const farid = await loginAs(app, 'helios', 'farid@helios.example');
    const [helios] = await owner.client`SELECT id FROM organisations WHERE slug = 'helios'`;
    expect(((await (await farid.get('/v1/probe/transaction')).json()) as Record<string, string>).org_id).toBe(helios!.id);
  });

  it('does not leave the organisation set on the connection once the request ends', async () => {
    await sam.get('/v1/probe/transaction');
    // Every pooled connection, outside any request: the setting must be gone.
    const leftovers = await Promise.all(
      Array.from({ length: 12 }, () => api.db.execute(sql`SELECT coalesce(current_setting('app.org_id', true), '') AS org_id`)),
    );
    expect(leftovers.map(([row]) => row!.org_id)).toEqual(Array(12).fill(''));
  });
});

describe('a request that fails leaves no writes behind', () => {
  it('keeps the write when the request succeeds', async () => {
    expect(await pilotCategory()).toBe('flight');
    expect((await sam.post('/v1/probe/recategorise/success')).status).toBe(200);
    expect(await pilotCategory()).toBe('changed');
    await owner.client`UPDATE skills SET category = 'flight' WHERE name = 'pilot'`;
  });

  it.each([
    ['a thrown domain error', 'domain-error', 403],
    ['an unexpected error', 'crash', 500],
    ['a response of 400 or above that was returned, not thrown', 'conflict-response', 409],
    ['a failed query', 'bad-sql', 500],
  ])('rolls back after %s', async (_, outcome, status) => {
    expect((await sam.post(`/v1/probe/recategorise/${outcome}`)).status).toBe(status);
    expect(await pilotCategory()).toBe('flight');
  });

  it('hides the detail of an unexpected error from the caller and reports it to the server', async () => {
    api.unexpectedErrors.length = 0;
    const response = await sam.post('/v1/probe/recategorise/crash');
    expect(errorResponseSchema.parse(await response.json())).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong on the server.' },
    });
    expect(api.unexpectedErrors.map((error) => (error as Error).message)).toEqual(['A bug after writing.']);
  });
});

describe('permissions', () => {
  it('lets a director read the organisation and its settings', async () => {
    const response = await dana.get('/v1/org');
    expect(response.status).toBe(200);
    expect(orgResponseSchema.parse(await response.json())).toEqual({
      slug: 'artemis',
      name: 'Artemis',
      settings: {
        approvals_required: 1,
        allow_unfilled_submission: false,
        min_rest_days: 0,
        match_weights: { proficiency: 0.45, workload: 0.35, rest: 0.2 },
      },
    });
  });

  it('answers 403 to a role that can see the organisation exists but may not read it', async () => {
    for (const email of ['sam@artemis.example', 'ada@artemis.example']) {
      const response = await (await loginAs(app, 'artemis', email)).get('/v1/org');
      expect(response.status).toBe(403);
      expect(errorResponseSchema.parse(await response.json()).error).toMatchObject({
        code: 'FORBIDDEN',
        message: 'Your role does not allow this.',
      });
    }
  });

  it('answers 404, in the shared error shape, for an address that does not exist', async () => {
    const response = await sam.get('/v1/no-such-thing');
    expect(response.status).toBe(404);
    expect(errorResponseSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('does not reveal which addresses exist to a caller who is not logged in', async () => {
    expect((await app.request('/v1/no-such-thing')).status).toBe(401);
    expect((await app.request('/v1/org')).status).toBe(401);
  });
});
