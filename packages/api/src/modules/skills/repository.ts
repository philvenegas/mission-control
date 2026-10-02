import { and, asc, eq } from 'drizzle-orm';
import { skills } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

export function listSkills({ tx, orgId }: TenantContext) {
  return tx.select({ name: skills.name, category: skills.category }).from(skills).where(eq(skills.orgId, orgId)).orderBy(asc(skills.name));
}

export async function findSkillByName({ tx, orgId }: TenantContext, name: string) {
  const [skill] = await tx.select({ id: skills.id, name: skills.name }).from(skills).where(and(eq(skills.orgId, orgId), eq(skills.name, name)));
  return skill;
}
