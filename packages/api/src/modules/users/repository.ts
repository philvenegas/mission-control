import { and, eq } from 'drizzle-orm';
import { organisations, users } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

/** The user the token names, with their organisation, if they still exist in the token's organisation. */
export async function findActingUser({ tx, orgId, userId }: TenantContext) {
  const [actingUser] = await tx
    .select({
      user: { email: users.email, name: users.name, role: users.role },
      organisation: { slug: organisations.slug, name: organisations.name },
    })
    .from(users)
    .innerJoin(organisations, eq(organisations.id, users.orgId))
    .where(and(eq(users.orgId, orgId), eq(users.id, userId)));
  return actingUser;
}
