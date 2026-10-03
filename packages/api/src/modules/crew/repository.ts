import type { CrewStatus } from '@mission-control/contract';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { crewMembers, crewSkills, skills, users } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

export interface CrewMemberRow {
  id: string;
  ref: number;
  name: string;
  status: CrewStatus;
  userId: string | null;
  userEmail: string | null;
}

function selectCrewMembers({ tx, orgId }: TenantContext, condition?: SQL) {
  return tx
    .select({
      id: crewMembers.id,
      ref: crewMembers.ref,
      name: crewMembers.name,
      status: crewMembers.status,
      userId: crewMembers.userId,
      userEmail: users.email,
    })
    .from(crewMembers)
    .leftJoin(users, and(eq(users.orgId, crewMembers.orgId), eq(users.id, crewMembers.userId)))
    .where(and(eq(crewMembers.orgId, orgId), condition))
    .orderBy(asc(crewMembers.ref));
}

/** Every crew member of the organisation, or only the one linked to `userId`. */
export function listCrewMembers(context: TenantContext, onlyUserId?: string): Promise<CrewMemberRow[]> {
  return selectCrewMembers(context, onlyUserId === undefined ? undefined : eq(crewMembers.userId, onlyUserId));
}

export async function findCrewMemberByRef(context: TenantContext, ref: number): Promise<CrewMemberRow | undefined> {
  const [crewMember] = await selectCrewMembers(context, eq(crewMembers.ref, ref));
  return crewMember;
}

export async function findCrewMemberByUser(context: TenantContext, userId: string): Promise<CrewMemberRow | undefined> {
  const [crewMember] = await selectCrewMembers(context, eq(crewMembers.userId, userId));
  return crewMember;
}

/** The skills held by each of the given crew members, by skill name. */
export function listCrewSkills({ tx, orgId }: TenantContext, crewMemberIds: string[]) {
  return tx
    .select({ crewMemberId: crewSkills.crewMemberId, skill: skills.name, level: crewSkills.level, certifiedUntil: crewSkills.certifiedUntil })
    .from(crewSkills)
    .innerJoin(skills, and(eq(skills.orgId, crewSkills.orgId), eq(skills.id, crewSkills.skillId)))
    .where(and(eq(crewSkills.orgId, orgId), inArray(crewSkills.crewMemberId, crewMemberIds)))
    .orderBy(asc(skills.name));
}

export async function insertCrewMember({ tx, orgId }: TenantContext, values: { ref: number; name: string }) {
  await tx.insert(crewMembers).values({ orgId, ...values });
}

export async function updateCrewMember({ tx, orgId }: TenantContext, id: string, changes: { name?: string; status?: CrewStatus }) {
  await tx.update(crewMembers).set(changes).where(and(eq(crewMembers.orgId, orgId), eq(crewMembers.id, id)));
}

export async function upsertCrewSkill(
  { tx, orgId }: TenantContext,
  values: { crewMemberId: string; skillId: string; level: number; certifiedUntil: string | null },
) {
  await tx
    .insert(crewSkills)
    .values({ orgId, ...values })
    .onConflictDoUpdate({ target: [crewSkills.crewMemberId, crewSkills.skillId], set: { level: values.level, certifiedUntil: values.certifiedUntil } });
}

/** Removes a skill from a crew member; false when they did not hold it. */
export async function deleteCrewSkill({ tx, orgId }: TenantContext, crewMemberId: string, skillId: string): Promise<boolean> {
  const removed = await tx
    .delete(crewSkills)
    .where(and(eq(crewSkills.orgId, orgId), eq(crewSkills.crewMemberId, crewMemberId), eq(crewSkills.skillId, skillId)))
    .returning({ skillId: crewSkills.skillId });
  return removed.length > 0;
}
