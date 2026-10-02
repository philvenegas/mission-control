import type { Skill } from '@mission-control/contract';
import type { TenantContext } from '../../db/tenant.ts';
import { notFound } from '../../errors.ts';
import { findSkillByName, listSkills } from './repository.ts';

export const listSkillTaxonomy = (context: TenantContext): Promise<Skill[]> => listSkills(context);

/** A skill of the caller's organisation, by name. Another organisation's skill is not found. */
export async function getSkill(context: TenantContext, name: string) {
  const skill = await findSkillByName(context, name);
  if (!skill) throw notFound(`The skill "${name}"`);
  return skill;
}
