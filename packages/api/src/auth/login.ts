import type { LoginRequest, LoginResponse, Role } from '@mission-control/contract';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/connection.ts';
import { withTenant } from '../db/tenant.ts';
import { invalidLogin } from '../errors.ts';
import { describeActingUser } from '../modules/users/service.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { signToken } from './token.ts';

interface LoginRow extends Record<string, unknown> {
  user_id: string;
  org_id: string;
  role: Role;
  password_hash: string;
}

// Checked when no user is found, so an unknown email takes as long to refuse as a wrong password.
const UNUSED_HASH = hashPassword('no user has this password');

/**
 * Finds the user by organisation slug and email through the one privileged lookup, checks the
 * password and signs a token. Every failure is the same error.
 */
export async function login(
  db: Database,
  request: LoginRequest,
  token: { secret: string; ttlSeconds: number },
): Promise<LoginResponse> {
  const [found] = await db.execute<LoginRow>(sql`SELECT * FROM auth_find_user(${request.org}, ${request.email})`);
  if (!verifyPassword(request.password, found?.password_hash ?? UNUSED_HASH) || !found) throw invalidLogin();

  const claims = { userId: found.user_id, orgId: found.org_id, role: found.role };
  const signed = await signToken(claims, token.secret, token.ttlSeconds);
  const actingAs = await withTenant(db, claims, describeActingUser);
  return { ...actingAs, token: signed.token, expires_at: signed.expiresAt.toISOString() };
}
