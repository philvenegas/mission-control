import type { LoginRequest, LoginResponse } from '@mission-control/contract';
import type { Database } from '../db/connection.ts';
import { withTenant } from '../db/tenant.ts';
import { invalidLogin } from '../errors.ts';
import { describeActingUser } from '../modules/users/service.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { findUserForLogin } from './repository.ts';
import { signToken, type TokenSettings } from './token.ts';

// Checked when no user is found, so an unknown email takes as long to refuse as a wrong password.
const UNUSED_HASH = hashPassword('no user has this password');

/** Checks the password and signs a token. Every failure is the same error. */
export async function login(db: Database, request: LoginRequest, tokenSettings: TokenSettings): Promise<LoginResponse> {
  const user = await findUserForLogin(db, request.org, request.email);
  const passwordMatches = verifyPassword(request.password, user?.password_hash ?? UNUSED_HASH);
  if (!user || !passwordMatches) throw invalidLogin();

  const claims = { userId: user.user_id, orgId: user.org_id, role: user.role };
  const { token, expiresAt } = await signToken(claims, tokenSettings);
  const actingAs = await withTenant(db, claims, describeActingUser);
  return { ...actingAs, token, expires_at: expiresAt.toISOString() };
}
