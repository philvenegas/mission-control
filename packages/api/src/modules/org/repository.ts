import { eq } from 'drizzle-orm';
import { exactlyOne } from '../../db/rows.ts';
import { organisations } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

/** The caller's own organisation. It exists: the request pipeline has found the caller in it. */
export async function getOrganisation({ tx, orgId }: TenantContext) {
  const rows = await tx
    .select({ slug: organisations.slug, name: organisations.name, settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, orgId));
  return exactlyOne(rows, 'organisation');
}
