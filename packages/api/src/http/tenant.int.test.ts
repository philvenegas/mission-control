import { DEFAULT_ORG_SETTINGS, errorResponseSchema, orgResponseSchema } from '@mission-control/contract';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseDatabaseUrl } from '../db/connection.ts';
import { exactlyOne } from '../db/rows.ts';
import { skills } from '../db/schema.ts';
import type { TenantContext } from '../db/tenant.ts';
import { requireEnv } from '../env.ts';
import { forbidden } from '../errors.ts';
import { loginAs, TEST_TOKEN, useSeededApp } from '../test/app.ts';
import { createApp } from './app.ts';
import type { Route } from './route.ts';

const artemisPilot = ({ orgId }: TenantContext) => and(eq(skills.orgId, orgId), eq(skills.name, 'pilot'));
const transactionSchema = z.object({ org_id: z.string(), database_role: z.string() });
const categorySchema = z.object({ category: z.string() });

// Probe routes, registered only in this test. They sit behind the same pipeline as every real
// route, so they show what a handler's transaction is and what becomes of its writes.
const PROBES: Route[] = [
  {
    method: 'GET',
    path: '/v1/probe/transaction',
    permission: 'me:read',
    handler: async (context) => {
      const rows = await context.var.tenant.tx.execute(
        sql`SELECT current_setting('app.org_id', true) AS org_id, current_user AS database_role`,
      );
      return context.json(exactlyOne(rows, 'row'));
    },
  },
  {
    method: 'GET',
    path: '/v1/probe/pilot-category',
    permission: 'me:read',
    handler: async (context) => {
      const { tenant } = context.var;
      return context.json(exactlyOne(await tenant.tx.select({ category: skills.category }).from(skills).where(artemisPilot(tenant)), 'skill'));
    },
  },
  {
    method: 'POST',
    path: '/v1/probe/recategorise/:outcome',
    permission: 'me:read',
    handler: async (context) => {
      const { tenant } = context.var;
      await tenant.tx.update(skills).set({ category: 'changed' }).where(artemisPilot(tenant));
      const outcome = context.req.param('outcome');
      if (outcome === 'domain-error') throw forbidden('Refused after writing.');
      if (outcome === 'crash') throw new Error('A bug after writing.');
      if (outcome === 'conflict-response') return context.json({ error: { code: 'INVALID_INPUT', message: 'Refused by response.' } }, 409);
      if (outcome === 'bad-sql') await tenant.tx.execute(sql`SELECT * FROM no_such_table`);
      return context.json({ category: 'changed' });
    },
  },
];

const { app, owner, api, unexpectedErrors } = useSeededApp(PROBES);

const sam = () => loginAs(app, 'artemis', 'sam@artemis.example');
const organisationId = async (slug: string) => String(exactlyOne(await owner`SELECT id FROM organisations WHERE slug = ${slug}`, 'organisation').id);
const transactionOf = async (org: string, email: string) =>
  transactionSchema.parse(await (await (await loginAs(app, org, email)).get('/v1/probe/transaction')).json());
const pilotCategory = async () => categorySchema.parse(await (await (await sam()).get('/v1/probe/pilot-category')).json()).category;

describe("a request's transaction", () => {
  it("runs as the API database role with the token's organisation set", async () => {
    expect(await transactionOf('artemis', 'sam@artemis.example')).toEqual({
      org_id: await organisationId('artemis'),
      database_role: parseDatabaseUrl(requireEnv('TEST_DATABASE_URL')).role,
    });
  });

  it("sets a different organisation for a different organisation's user", async () => {
    expect((await transactionOf('helios', 'farid@helios.example')).org_id).toBe(await organisationId('helios'));
  });

  it('does not leave the organisation set on any pooled connection once the request ends', async () => {
    await transactionOf('artemis', 'sam@artemis.example');
    // More concurrent queries than the pool has connections, so every connection answers.
    const queries = Array.from({ length: api.client.options.max * 2 }, () =>
      api.db.execute(sql`SELECT coalesce(current_setting('app.org_id', true), '') AS org_id`),
    );
    const settings = (await Promise.all(queries)).map((rows) => exactlyOne(rows, 'row').org_id);
    expect(new Set(settings)).toEqual(new Set(['']));
  });
});

describe('a request that fails leaves no writes behind', () => {
  it('keeps the write when the request succeeds', async () => {
    expect(await pilotCategory()).toBe('flight');
    expect((await (await sam()).post('/v1/probe/recategorise/success')).status).toBe(200);
    expect(await pilotCategory()).toBe('changed');
    await owner`UPDATE skills SET category = 'flight' WHERE name = 'pilot'`;
  });

  it.each([
    ['a thrown domain error', 'domain-error', 403],
    ['an unexpected error', 'crash', 500],
    ['a response of 400 or above that was returned, not thrown', 'conflict-response', 409],
    ['a failed query', 'bad-sql', 500],
  ])('rolls back after %s', async (_, outcome, status) => {
    expect((await (await sam()).post(`/v1/probe/recategorise/${outcome}`)).status).toBe(status);
    expect(await pilotCategory()).toBe('flight');
  });

  it('hides the detail of an unexpected error from the caller and reports it to the server', async () => {
    unexpectedErrors.length = 0;
    const response = await (await sam()).post('/v1/probe/recategorise/crash');
    expect(errorResponseSchema.parse(await response.json())).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong on the server.' },
    });
    expect(unexpectedErrors.map(String)).toEqual(['Error: A bug after writing.']);
  });
});

describe('permissions', () => {
  it('lets a director read the organisation and its settings', async () => {
    const response = await (await loginAs(app, 'artemis', 'dana@artemis.example')).get('/v1/org');
    expect(response.status).toBe(200);
    expect(orgResponseSchema.parse(await response.json())).toEqual({ slug: 'artemis', name: 'Artemis', settings: DEFAULT_ORG_SETTINGS });
  });

  it.each(['sam@artemis.example', 'ada@artemis.example'])(
    'answers 403 to %s, who knows the organisation exists but may not read its settings',
    async (email) => {
      const response = await (await loginAs(app, 'artemis', email)).get('/v1/org');
      expect(response.status).toBe(403);
      expect(errorResponseSchema.parse(await response.json()).error).toEqual({
        code: 'FORBIDDEN',
        message: 'Your role does not allow this.',
      });
    },
  );

  it('refuses to run a handler that was registered without a permission', async () => {
    const reported: unknown[] = [];
    const careless = createApp({ db: api.db, token: TEST_TOKEN, onUnexpectedError: (error) => reported.push(error) });
    let handlerRan = false;
    careless.get('/v1/unguarded', (context) => {
      handlerRan = true;
      return context.json({ secret: 'everything' });
    });
    careless.all('/v1/unguarded-any-method', (context) => context.json({ secret: 'everything' }));
    const caller = await loginAs(careless, 'artemis', 'dana@artemis.example');
    expect((await caller.get('/v1/unguarded')).status).toBe(500);
    expect((await caller.post('/v1/unguarded-any-method')).status).toBe(500);
    expect(handlerRan).toBe(false);
    expect(reported.map(String)).toEqual([
      'Error: GET /v1/unguarded was registered without a permission',
      'Error: ALL /v1/unguarded-any-method was registered without a permission',
    ]);
  });

  it('answers 404, in the shared error shape, for an address that does not exist', async () => {
    const response = await (await sam()).get('/v1/no-such-thing');
    expect(response.status).toBe(404);
    expect(errorResponseSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('does not reveal which addresses exist to a caller who is not logged in', async () => {
    expect((await app.request('/v1/no-such-thing')).status).toBe(401);
    expect((await app.request('/v1/org')).status).toBe(401);
  });
});
