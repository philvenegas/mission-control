import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import { parseTtl, signToken, type TokenClaims, verifyToken } from './token.ts';

const SECRET = 'a-secret-for-tests-only';
const claims: TokenClaims = { userId: 'user-1', orgId: 'org-1', role: 'mission_lead' };
const HOUR = 60 * 60;

describe('a token', () => {
  it('carries the user, organisation and role it was signed with', async () => {
    const { token } = await signToken(claims, { secret: SECRET, ttlSeconds: 12 * HOUR });
    expect(await verifyToken(token, SECRET)).toEqual(claims);
  });

  it('expires after its lifetime', async () => {
    const now = new Date('2026-10-02T09:00:00Z');
    const { expiresAt } = await signToken(claims, { secret: SECRET, ttlSeconds: 12 * HOUR }, now);
    expect(expiresAt.toISOString()).toBe('2026-10-02T21:00:00.000Z');

    const thirteenHoursAgo = new Date(Date.now() - 13 * HOUR * 1000);
    const { token } = await signToken(claims, { secret: SECRET, ttlSeconds: 12 * HOUR }, thirteenHoursAgo);
    await expect(verifyToken(token, SECRET)).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Your login has expired.' });
  });

  it('is refused when signed with another secret, altered, or not a token at all', async () => {
    const { token } = await signToken(claims, { secret: 'another-secret', ttlSeconds: HOUR });
    const [header, payload, signature] = (await signToken(claims, { secret: SECRET, ttlSeconds: HOUR })).token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'user-1', org: 'org-2', role: 'director' })).toString('base64url');
    for (const bad of [token, `${header}.${forgedPayload}.${signature}`, `${header}.${payload}.`, 'not-a-token', '']) {
      await expect(verifyToken(bad, SECRET)).rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Your login is not valid.' });
    }
  });

  it('is refused when unsigned', async () => {
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: 'user-1', org: 'org-1', role: 'director' }),
    ).toString('base64url')}.`;
    await expect(verifyToken(unsigned, SECRET)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('is refused when correctly signed but missing a claim or naming an unknown role', async () => {
    const exp = Math.floor(Date.now() / 1000) + HOUR;
    for (const payload of [{ org: 'org-1', role: 'director', exp }, { sub: 'user-1', role: 'director', exp }, { sub: 'user-1', org: 'org-1', role: 'admin', exp }]) {
      await expect(verifyToken(await sign(payload, SECRET, 'HS256'), SECRET)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
});

describe('a token lifetime', () => {
  it('is read from seconds, minutes, hours or days', () => {
    expect(parseTtl('45s')).toBe(45);
    expect(parseTtl('30m')).toBe(1800);
    expect(parseTtl('12h')).toBe(43_200);
    expect(parseTtl('7d')).toBe(604_800);
  });

  it.each(['', '12', 'h', '0h', '-1h', '1.5h', '12 hours', '1w'])('refuses "%s"', (ttl) => {
    expect(() => parseTtl(ttl)).toThrow(/is not a lifetime/);
  });
});
