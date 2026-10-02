import type { Role } from '@mission-control/contract';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/connection.ts';

interface LoginRow extends Record<string, unknown> {
  user_id: string;
  org_id: string;
  role: Role;
  password_hash: string;
}

/**
 * The one lookup that crosses organisations, and the one query made outside a request's
 * transaction: login happens before any tenant is known. It goes through the privileged
 * `auth_find_user` function and nothing else.
 */
export async function findUserForLogin(db: Database, orgSlug: string, email: string): Promise<LoginRow | undefined> {
  const [user] = await db.execute<LoginRow>(sql`SELECT * FROM auth_find_user(${orgSlug}, ${email})`);
  return user;
}
