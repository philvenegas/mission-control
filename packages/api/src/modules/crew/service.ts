import { type CreateCrewMember, type CrewMember, formatRef, type SetCrewSkill, type UpdateCrewMember } from '@mission-control/contract';
import { can, type Permission, scopeOf } from '../../auth/policy.ts';
import { exactlyOne } from '../../db/rows.ts';
import { refNumber, takeNextRef } from '../../db/refs.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { forbidden, notFound } from '../../errors.ts';
import { getSkill } from '../skills/service.ts';
import {
  type CrewMemberRow,
  deleteCrewSkill,
  findCrewMemberByRef,
  findCrewMemberByUser,
  insertCrewMember,
  listCrewMembers,
  listCrewSkills,
  updateCrewMember,
  upsertCrewSkill,
} from './repository.ts';

/** What a caller may write in a path to mean their own crew record. */
export const OWN_CREW_RECORD = 'me';

async function withSkills(context: TenantContext, rows: CrewMemberRow[]): Promise<CrewMember[]> {
  const held = await listCrewSkills(context, rows.map((row) => row.id));
  return rows.map((row) => ({
    ref: formatRef('crew_member', row.ref),
    name: row.name,
    status: row.status,
    user_email: row.userEmail,
    skills: held
      .filter((skill) => skill.crewMemberId === row.id)
      .map((skill) => ({ skill: skill.skill, level: skill.level, certified_until: skill.certifiedUntil })),
  }));
}

const describe = async (context: TenantContext, row: CrewMemberRow) => exactlyOne(await withSkills(context, [row]), 'crew member');

/**
 * The crew member a path names (`CRW-7`, or `me` for the caller's own record), within what the
 * permission lets the caller reach. A crew member the caller may not reach is not found.
 */
export async function resolveCrewMember(context: TenantContext, text: string, permission: Permission): Promise<CrewMemberRow> {
  const scope = scopeOf(context.role, permission);
  if (!scope) throw forbidden('Your role does not allow this.');
  const crewMember =
    text.toLowerCase() === OWN_CREW_RECORD
      ? await findCrewMemberByUser(context, context.userId)
      : await findCrewMemberByRef(context, refNumber('crew_member', text));
  if (!crewMember || (scope === 'own' && crewMember.userId !== context.userId)) {
    throw notFound(text.toLowerCase() === OWN_CREW_RECORD ? 'Your crew record' : text);
  }
  return crewMember;
}

export async function listCrew(context: TenantContext): Promise<CrewMember[]> {
  const own = scopeOf(context.role, 'crew:read') === 'own';
  return withSkills(context, await listCrewMembers(context, own ? context.userId : undefined));
}

export async function showCrewMember(context: TenantContext, text: string): Promise<CrewMember> {
  return describe(context, await resolveCrewMember(context, text, 'crew:read'));
}

export async function addCrewMember(context: TenantContext, input: CreateCrewMember): Promise<CrewMember> {
  const ref = await takeNextRef(context, 'crew_member');
  await insertCrewMember(context, { ref, name: input.name });
  return showCrewMember(context, formatRef('crew_member', ref));
}

export async function changeCrewMember(context: TenantContext, text: string, changes: UpdateCrewMember): Promise<CrewMember> {
  const crewMember = await resolveCrewMember(context, text, 'crew:edit');
  if (changes.status !== undefined && !can(context.role, 'crew:set-status')) {
    throw forbidden('Only a director can make a crew member active or inactive.');
  }
  await updateCrewMember(context, crewMember.id, changes);
  return showCrewMember(context, formatRef('crew_member', crewMember.ref));
}

export async function setCrewSkill(context: TenantContext, text: string, skillName: string, input: SetCrewSkill): Promise<CrewMember> {
  const crewMember = await resolveCrewMember(context, text, 'crew:edit');
  const skill = await getSkill(context, skillName);
  await upsertCrewSkill(context, {
    crewMemberId: crewMember.id,
    skillId: skill.id,
    level: input.level,
    certifiedUntil: input.certified_until ?? null,
  });
  return describe(context, crewMember);
}

export async function removeCrewSkill(context: TenantContext, text: string, skillName: string): Promise<CrewMember> {
  const crewMember = await resolveCrewMember(context, text, 'crew:edit');
  const skill = await getSkill(context, skillName);
  if (!(await deleteCrewSkill(context, crewMember.id, skill.id))) {
    throw notFound(`${formatRef('crew_member', crewMember.ref)}'s ${skill.name} skill`);
  }
  return describe(context, crewMember);
}
