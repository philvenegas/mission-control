import { and, eq } from 'drizzle-orm';
import { users } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

/** The user the token names, if they still exist in the token's organisation. */
export async function findActingUser({ tx, orgId, userId }: TenantContext) {
  const [user] = await tx
    .select({ email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.id, userId)));
  return user;
}
