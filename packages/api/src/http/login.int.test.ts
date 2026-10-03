import { errorResponseSchema, healthResponseSchema, loginResponseSchema, meResponseSchema } from '@mission-control/contract';
import { describe, expect, it } from 'vitest';
import { hashPassword } from '../auth/password.ts';
import { signToken } from '../auth/token.ts';
import { exactlyOne } from '../db/rows.ts';
import { DEMO_PASSWORD } from '../db/seed-data.ts';
import { callerWith, loginAs, postLogin, TEST_TOKEN, useSeededApp } from '../test/app.ts';

const { app, owner, unexpectedErrors } = useSeededApp();

const sam = { org: 'artemis', email: 'sam@artemis.example', password: DEMO_PASSWORD };
const NOT_LOGGED_IN = { status: 401, code: 'UNAUTHENTICATED' };

async function outcome(response: Response) {
  const { error } = errorResponseSchema.parse(await response.json());
  return { status: response.status, code: error.code, message: error.message, hint: error.hint };
}

/** The claims Sam's own token carries. */
async function samsClaims() {
  const rows = await owner`
    SELECT u.id, u.org_id FROM users u JOIN organisations o ON o.id = u.org_id
    WHERE u.email = ${sam.email} AND o.slug = ${sam.org}`;
  const { id, org_id } = exactlyOne(rows, 'user');
  return { userId: String(id), orgId: String(org_id), role: 'mission_lead' as const };
}

async function addUser(org: string, email: string, name: string, role: string, password: string) {
  await owner`
    INSERT INTO users (org_id, email, password_hash, name, role)
    SELECT id, ${email}, ${hashPassword(password)}, ${name}, ${role} FROM organisations WHERE slug = ${org}`;
}

describe('logging in', () => {
  it('gives a seeded user a token, and says who and which organisation it acts as', async () => {
    const before = Date.now();
    const response = await postLogin(app, sam);
    expect(response.status).toBe(200);
    const body = loginResponseSchema.parse(await response.json());
    expect(body.user).toEqual({ email: 'sam@artemis.example', name: 'Sam Okafor', role: 'mission_lead' });
    expect(body.organisation).toEqual({ slug: 'artemis', name: 'Artemis' });
    const lifetimeSeconds = (Date.parse(body.expires_at) - before) / 1000;
    expect(Math.abs(lifetimeSeconds - TEST_TOKEN.ttlSeconds)).toBeLessThan(5);
  });

  it('reads the organisation and email without regard to case', async () => {
    const response = await postLogin(app, { ...sam, org: 'Artemis', email: 'Sam@Artemis.Example' });
    expect(response.status).toBe(200);
  });

  it.each([
    ['a wrong password', { ...sam, password: 'mission-control-dem0' }],
    ['an email nobody has', { ...sam, email: 'nobody@artemis.example' }],
    ['an organisation that does not exist', { ...sam, org: 'apollo' }],
    ["another organisation's user", { ...sam, org: 'helios' }],
  ])('gives the one same answer for %s', async (_, body) => {
    expect(await outcome(await postLogin(app, body))).toEqual({
      status: 401,
      code: 'INVALID_LOGIN',
      message: 'Invalid organisation, email or password.',
      hint: 'Check all three and try again.',
    });
  });

  it('logs the same email in to each organisation that has it, separately', async () => {
    await addUser('helios', sam.email, 'Sam Other', 'crew_member', 'helios-only-password');
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

  it('refuses a request with no token', async () => {
    expect(await outcome(await app.request('/v1/me'))).toMatchObject({ ...NOT_LOGGED_IN, message: 'You are not logged in.' });
  });

  it.each([
    ['the bare token', (token: string) => token],
    ['another scheme', (token: string) => `Basic ${token}`],
    ['the scheme and no token', () => 'Bearer '],
  ])('refuses an Authorization header holding %s', async (_, header) => {
    const { token } = await signToken(await samsClaims(), TEST_TOKEN);
    expect((await app.request('/v1/me', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(await outcome(await app.request('/v1/me', { headers: { Authorization: header(token) } }))).toMatchObject(NOT_LOGGED_IN);
  });

  it('refuses a token signed with a secret the server does not have, even one claiming a higher role', async () => {
    const forged = await signToken({ ...(await samsClaims()), role: 'director' }, { ...TEST_TOKEN, secret: 'a-secret-the-server-does-not-have' });
    expect(await outcome(await callerWith(app, forged.token).get('/v1/org'))).toMatchObject({
      ...NOT_LOGGED_IN,
      message: 'Your login is not valid.',
    });
    expect(await outcome(await callerWith(app, 'not-a-token').get('/v1/me'))).toMatchObject(NOT_LOGGED_IN);
  });

  it('refuses an expired token and says to log in again', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expired = await signToken(await samsClaims(), TEST_TOKEN, yesterday);
    expect(await outcome(await callerWith(app, expired.token).get('/v1/me'))).toEqual({
      ...NOT_LOGGED_IN,
      message: 'Your login has expired.',
      hint: 'Log in with `mctl login`.',
    });
  });

  it('refuses, on every route, the token of a user who has since been removed', async () => {
    await addUser('artemis', 'temp@artemis.example', 'Temp Director', 'director', DEMO_PASSWORD);
    const temp = await loginAs(app, 'artemis', 'temp@artemis.example');
    expect((await temp.get('/v1/me')).status).toBe(200);
    expect((await temp.get('/v1/org')).status).toBe(200);
    await owner`DELETE FROM users WHERE email = 'temp@artemis.example'`;
    expect(await outcome(await temp.get('/v1/me'))).toMatchObject(NOT_LOGGED_IN);
    expect(await outcome(await temp.get('/v1/org'))).toMatchObject(NOT_LOGGED_IN);
  });

  it('refuses a token whose user is not in the organisation it names', async () => {
    const claims = await samsClaims();
    const helios = exactlyOne(await owner`SELECT id FROM organisations WHERE slug = 'helios'`, 'organisation');
    const crossed = await signToken({ ...claims, orgId: String(helios.id), role: 'director' }, TEST_TOKEN);
    expect(await outcome(await callerWith(app, crossed.token).get('/v1/org'))).toMatchObject(NOT_LOGGED_IN);
  });
});

describe('the health check', () => {
  it('answers without a login', async () => {
    const response = await app.request('/v1/health');
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({ status: 'ok' });
  });
});

it('raised no unexpected error along the way', () => {
  expect(unexpectedErrors).toEqual([]);
});
