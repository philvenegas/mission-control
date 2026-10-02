import { errorResponseSchema, loginResponseSchema, meResponseSchema } from '@mission-control/contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/password.ts';
import { signToken } from '../auth/token.ts';
import { DEMO_PASSWORD, seed } from '../db/seed.ts';
import { caller, loginAs, postLogin, startTestApp, TEST_TOKEN_SECRET, TEST_TOKEN_TTL_SECONDS } from '../test/app.ts';
import { connectAsOwner } from '../test/database.ts';

const owner = connectAsOwner();
const api = startTestApp();
const { app } = api;

beforeAll(async () => {
  await seed(owner.db);
});
afterAll(async () => {
  await Promise.all([owner.client.end(), api.close()]);
});

const sam = { org: 'artemis', email: 'sam@artemis.example', password: DEMO_PASSWORD };
const NOT_LOGGED_IN = { status: 401, code: 'UNAUTHENTICATED' };

async function outcome(response: Response) {
  const body = errorResponseSchema.parse(await response.json());
  return { status: response.status, code: body.error.code, message: body.error.message, hint: body.error.hint };
}

describe('logging in', () => {
  it('gives a seeded user a token, and says who and which organisation it acts as', async () => {
    const before = Date.now();
    const response = await postLogin(app, sam);
    expect(response.status).toBe(200);
    const body = loginResponseSchema.parse(await response.json());
    expect(body.user).toEqual({ email: 'sam@artemis.example', name: 'Sam Okafor', role: 'mission_lead' });
    expect(body.organisation).toEqual({ slug: 'artemis', name: 'Artemis' });
    const lifetime = Date.parse(body.expires_at) - before;
    expect(lifetime).toBeGreaterThan((TEST_TOKEN_TTL_SECONDS - 5) * 1000);
    expect(lifetime).toBeLessThanOrEqual((TEST_TOKEN_TTL_SECONDS + 5) * 1000);
  });

  it('reads the organisation and email without regard to case', async () => {
    const response = await postLogin(app, { ...sam, org: 'Artemis', email: 'Sam@Artemis.Example' });
    expect(response.status).toBe(200);
  });

  it('gives the same answer for every way a login can fail', async () => {
    const failures = {
      'a wrong password': { ...sam, password: 'mission-control-dem0' },
      'an email nobody has': { ...sam, email: 'nobody@artemis.example' },
      'an organisation that does not exist': { ...sam, org: 'apollo' },
      "another organisation's user": { ...sam, org: 'helios' },
    };
    for (const [, body] of Object.entries(failures)) {
      expect(await outcome(await postLogin(app, body))).toEqual({
        status: 401,
        code: 'INVALID_LOGIN',
        message: 'Invalid organisation, email or password.',
        hint: 'Check all three and try again.',
      });
    }
  });

  it('logs the same email in to each organisation that has it, separately', async () => {
    const hash = hashPassword('helios-only-password');
    await owner.client`
      INSERT INTO users (org_id, email, password_hash, name, role)
      SELECT id, 'sam@artemis.example', ${hash}, 'Sam Other', 'crew_member' FROM organisations WHERE slug = 'helios'`;
    const helios = await postLogin(app, { org: 'helios', email: sam.email, password: 'helios-only-password' });
    expect(loginResponseSchema.parse(await helios.json())).toMatchObject({
      user: { name: 'Sam Other', role: 'crew_member' },
      organisation: { slug: 'helios' },
    });
    // Neither password opens the other organisation's user.
    expect((await postLogin(app, { ...sam, password: 'helios-only-password' })).status).toBe(401);
    expect((await postLogin(app, { ...sam, org: 'helios' })).status).toBe(401);
  });

  it.each([
    ['a body that is not JSON', 'org=artemis'],
    ['a missing password', { org: 'artemis', email: 'sam@artemis.example' }],
    ['a blank organisation', { ...sam, org: ' ' }],
    ['a list instead of an object', [sam]],
  ])('refuses %s as invalid input', async (_, body) => {
    expect(await outcome(await postLogin(app, body))).toMatchObject({ status: 400, code: 'INVALID_INPUT' });
  });
});

describe('acting with a token', () => {
  it('answers who the caller is', async () => {
    const ada = await loginAs(app, 'artemis', 'ada@artemis.example');
    const response = await ada.get('/v1/me');
    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json())).toEqual({
      user: { email: 'ada@artemis.example', name: 'Ada Reyes', role: 'crew_member' },
      organisation: { slug: 'artemis', name: 'Artemis' },
    });
  });

  it('refuses a request with no token, or one that is not a bearer token', async () => {
    expect(await outcome(await app.request('/v1/me'))).toMatchObject({ ...NOT_LOGGED_IN, message: 'You are not logged in.' });
    const { token } = await loginAs(app, 'artemis', 'sam@artemis.example');
    for (const header of [token, `Basic ${token}`, 'Bearer ', 'Bearer']) {
      expect(await outcome(await app.request('/v1/me', { headers: { Authorization: header } }))).toMatchObject(NOT_LOGGED_IN);
    }
  });

  it('refuses a token that is forged or signed with another secret', async () => {
    const [sam] = await owner.client`SELECT id, org_id FROM users WHERE email = 'sam@artemis.example' AND role = 'mission_lead'`;
    const claims = { userId: sam!.id, orgId: sam!.org_id, role: 'director' as const };
    const forged = await signToken(claims, 'a-secret-the-server-does-not-have', 3600);
    expect(await outcome(await caller(app, forged.token).get('/v1/me'))).toMatchObject({
      ...NOT_LOGGED_IN,
      message: 'Your login is not valid.',
    });
    expect(await outcome(await caller(app, 'not-a-token').get('/v1/me'))).toMatchObject(NOT_LOGGED_IN);
  });

  it('refuses an expired token and says to log in again', async () => {
    const [sam] = await owner.client`SELECT id, org_id FROM users WHERE email = 'sam@artemis.example' AND role = 'mission_lead'`;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expired = await signToken({ userId: sam!.id, orgId: sam!.org_id, role: 'mission_lead' }, TEST_TOKEN_SECRET, 3600, yesterday);
    expect(await outcome(await caller(app, expired.token).get('/v1/me'))).toEqual({
      ...NOT_LOGGED_IN,
      message: 'Your login has expired.',
      hint: 'Log in with `mctl login`.',
    });
  });

  it('refuses the token of a user who has since been removed', async () => {
    await owner.client`
      INSERT INTO users (org_id, email, password_hash, name, role)
      SELECT id, 'temp@artemis.example', ${hashPassword(DEMO_PASSWORD)}, 'Temp User', 'mission_lead' FROM organisations WHERE slug = 'artemis'`;
    const temp = await loginAs(app, 'artemis', 'temp@artemis.example');
    expect((await temp.get('/v1/me')).status).toBe(200);
    await owner.client`DELETE FROM users WHERE email = 'temp@artemis.example'`;
    expect(await outcome(await temp.get('/v1/me'))).toMatchObject(NOT_LOGGED_IN);
  });
});

describe('the health check', () => {
  it('answers without a login', async () => {
    const response = await app.request('/v1/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});

it('raised no unexpected error along the way', () => {
  expect(api.unexpectedErrors).toEqual([]);
});
