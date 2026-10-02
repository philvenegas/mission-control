import { sql } from 'drizzle-orm';
import type { TokenClaims } from '../auth/token.ts';
import type { Database } from './connection.ts';

/**
 * What every repository function takes: the request's transaction, already confined to one
 * organisation, and who is acting. Module code has no other way to reach the database.
 */
export interface TenantContext extends TokenClaims {
  tx: Database;
}

/**
 * Runs `work` in one transaction with `app.org_id` set from the token. The setting is local to the
 * transaction, so it never leaks to the next request on the same pooled connection.
 */
export function withTenant<T>(db: Database, claims: TokenClaims, work: (context: TenantContext) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.org_id', ${claims.orgId}, true)`);
    return work({ ...claims, tx });
  });
}
