import { type CreateCrewMember, type CrewMember, formatRef, type SetCrewSkill, type UpdateCrewMember } from '@mission-control/contract';
import { can, type Permission, reaches, scopeOf } from '../../auth/policy.ts';
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
  lockCrewMembers,
  listCrewMembers,
  listCrewSkills,
  updateCrewMember,
  upsertCrewSkill,
} from './repository.ts';

/** What a caller may write in a path to mean their own crew record. */
const OWN_CREW_RECORD = 'me';

async function withSkills(context: TenantContext, rows: CrewMemberRow[]): Promise<CrewMember[]> {
  const crewSkills = await listCrewSkills(context, rows.map((row) => row.id));
  return rows.map((row) => ({
    ref: formatRef('crew_member', row.ref),
    name: row.name,
    status: row.status,
    user_email: row.userEmail,
    skills: crewSkills
      .filter((skill) => skill.crewMemberId === row.id)
      .map((skill) => ({ skill: skill.skill, level: skill.level, certified_until: skill.certifiedUntil })),
  }));
}

const toCrewMember = async (context: TenantContext, row: CrewMemberRow) => exactlyOne(await withSkills(context, [row]), 'crew member');

/**
 * The crew member a reference names (`CRW-7`, or `me` for the caller's own record), if the
 * permission lets the caller reach them. One the caller does not reach is not found.
 */
export async function resolveCrewMember(context: TenantContext, crewMemberRef: string, permission: Permission): Promise<CrewMemberRow> {
  const own = crewMemberRef.toLowerCase() === OWN_CREW_RECORD;
  const crewMember = own
    ? await findCrewMemberByUser(context, context.userId)
    : await findCrewMemberByRef(context, refNumber('crew_member', crewMemberRef));
  if (!crewMember || !reaches(context, permission, crewMember.userId)) throw notFound(own ? 'Your crew record' : crewMemberRef);
  return crewMember;
}

export async function listCrew(context: TenantContext): Promise<CrewMember[]> {
  const own = scopeOf(context.role, 'crew:read') === 'own';
  return withSkills(context, await listCrewMembers(context, own ? context.userId : undefined));
}

export async function showCrewMember(context: TenantContext, crewMemberRef: string): Promise<CrewMember> {
  return toCrewMember(context, await resolveCrewMember(context, crewMemberRef, 'crew:read'));
}

export async function addCrewMember(context: TenantContext, input: CreateCrewMember): Promise<CrewMember> {
  const ref = await takeNextRef(context, 'crew_member');
  await insertCrewMember(context, { ref, name: input.name });
  return showCrewMember(context, formatRef('crew_member', ref));
}

export async function changeCrewMember(context: TenantContext, crewMemberRef: string, changes: UpdateCrewMember): Promise<CrewMember> {
  const crewMember = await resolveCrewMember(context, crewMemberRef, 'crew:edit');
  await lockCrewMembers(context, [crewMember.id]);
  if (changes.status !== undefined && !can(context.role, 'crew:set-status')) {
    throw forbidden('Only a director can make a crew member active or inactive.');
  }
  await updateCrewMember(context, crewMember.id, changes);
  return showCrewMember(context, formatRef('crew_member', crewMember.ref));
}

export async function setCrewSkill(
  context: TenantContext,
  crewMemberRef: string,
  skillName: string,
  input: SetCrewSkill,
): Promise<CrewMember> {
  const crewMember = await resolveCrewMember(context, crewMemberRef, 'crew:edit');
  await lockCrewMembers(context, [crewMember.id]);
  const skill = await getSkill(context, skillName);
  await upsertCrewSkill(context, {
    crewMemberId: crewMember.id,
    skillId: skill.id,
    level: input.level,
    certifiedUntil: input.certified_until ?? null,
  });
  return toCrewMember(context, crewMember);
}

export async function removeCrewSkill(context: TenantContext, crewMemberRef: string, skillName: string): Promise<CrewMember> {
  const crewMember = await resolveCrewMember(context, crewMemberRef, 'crew:edit');
  await lockCrewMembers(context, [crewMember.id]);
  const skill = await getSkill(context, skillName);
  if (!(await deleteCrewSkill(context, crewMember.id, skill.id))) {
    throw notFound(`${formatRef('crew_member', crewMember.ref)}'s ${skill.name} skill`);
  }
  return toCrewMember(context, crewMember);
}
