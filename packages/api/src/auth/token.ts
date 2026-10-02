import { type Role, ROLES } from '@mission-control/contract';
import { sign, verify } from 'hono/jwt';
import { unauthenticated } from '../errors.ts';

const ALGORITHM = 'HS256';

/** Who a request acts as. It comes only from the signed token, never from a path or body. */
export interface TokenClaims {
  userId: string;
  orgId: string;
  role: Role;
}

const SECONDS = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 } as const;

/** A lifetime such as `12h`, `7d` or `30m`, in seconds. */
export function parseTtl(ttl: string): number {
  const match = /^([1-9]\d*)([smhd])$/.exec(ttl.trim());
  if (!match) throw new Error(`TOKEN_TTL "${ttl}" is not a lifetime such as 12h, 7d or 30m`);
  return Number(match[1]) * SECONDS[match[2] as keyof typeof SECONDS];
}

export async function signToken(
  claims: TokenClaims,
  secret: string,
  ttlSeconds: number,
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
  if (typeof sub !== 'string' || typeof org !== 'string' || !ROLES.includes(role as Role)) {
    throw unauthenticated('Your login is not valid.');
  }
  return { userId: sub, orgId: org, role: role as Role };
}
