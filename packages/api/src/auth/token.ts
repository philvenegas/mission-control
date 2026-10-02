import { isRole, type Role } from '@mission-control/contract';
import { sign, verify } from 'hono/jwt';
import { unauthenticated } from '../errors.ts';

const ALGORITHM = 'HS256';

/** Who a request acts as. It comes only from the signed token, never from a path or body. */
export interface TokenClaims {
  userId: string;
  orgId: string;
  role: Role;
}

/** What the server signs tokens with, and how long they last. */
export interface TokenSettings {
  secret: string;
  ttlSeconds: number;
}

const SECONDS_PER_UNIT = new Map([
  ['s', 1],
  ['m', 60],
  ['h', 60 * 60],
  ['d', 24 * 60 * 60],
]);

/** A lifetime such as `12h`, `7d` or `30m`, in seconds. */
export function parseTtl(ttl: string): number {
  const [, count, unit] = /^([1-9]\d*)([a-z])$/.exec(ttl.trim()) ?? [];
  const seconds = SECONDS_PER_UNIT.get(unit ?? '');
  if (!count || !seconds) throw new Error(`TOKEN_TTL "${ttl}" is not a lifetime such as 12h, 7d or 30m`);
  return Number(count) * seconds;
}

export async function signToken(
  claims: TokenClaims,
  { secret, ttlSeconds }: TokenSettings,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expires = issuedAt + ttlSeconds;
  const token = await sign({ sub: claims.userId, org: claims.orgId, role: claims.role, iat: issuedAt, exp: expires }, secret, ALGORITHM);
  return { token, expiresAt: new Date(expires * 1000) };
}

/** The claims of a token this server signed and that has not expired; anything else is not logged in. */
export async function verifyToken(token: string, secret: string): Promise<TokenClaims> {
  let payload: Record<string, unknown>;
  try {
    payload = await verify(token, secret, ALGORITHM);
  } catch (error) {
    const expired = error instanceof Error && error.name === 'JwtTokenExpired';
    throw unauthenticated(expired ? 'Your login has expired.' : 'Your login is not valid.');
  }
  const { sub, org, role } = payload;
  if (typeof sub !== 'string' || typeof org !== 'string' || !isRole(role)) {
    throw unauthenticated('Your login is not valid.');
  }
  return { userId: sub, orgId: org, role };
}
