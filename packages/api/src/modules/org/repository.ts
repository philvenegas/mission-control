import { eq } from 'drizzle-orm';
import { organisations } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

export async function findOrganisation({ tx, orgId }: TenantContext) {
  const [organisation] = await tx
    .select({ slug: organisations.slug, name: organisations.name, settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, orgId));
  return organisation;
}
