import type { AssignmentStatus, Period } from '@mission-control/contract';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { assignments, crewMembers, matchRuns, missionRequirements, missions, skills, users } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

const owners = alias(users, 'owners');

/**
 * The crew in each of the given missions' slots, in reference order, with who placed them and how:
 * the match run that chose them, or none when `assignedBy` assigned them by hand. Released
 * assignments are no longer in a slot, so they are left out.
 */
export function listMissionCrew({ tx, orgId }: TenantContext, missionIds: string[]) {
  return tx
    .select({
      missionId: assignments.missionId,
      requirementId: assignments.requirementId,
      ref: assignments.ref,
      crewMember: { ref: crewMembers.ref, name: crewMembers.name },
      status: assignments.status,
      score: assignments.score,
      matchRunRef: matchRuns.ref,
      assignedBy: { name: users.name, email: users.email },
      declineReason: assignments.declineReason,
    })
    .from(assignments)
    .innerJoin(crewMembers, and(eq(crewMembers.orgId, assignments.orgId), eq(crewMembers.id, assignments.crewMemberId)))
    .innerJoin(users, and(eq(users.orgId, assignments.orgId), eq(users.id, assignments.createdBy)))
    .leftJoin(matchRuns, and(eq(matchRuns.orgId, assignments.orgId), eq(matchRuns.id, assignments.matchRunId)))
    .where(and(eq(assignments.orgId, orgId), inArray(assignments.missionId, missionIds), ne(assignments.status, 'released')))
    .orderBy(asc(assignments.ref));
}

export type MissionCrewRow = Awaited<ReturnType<typeof listMissionCrew>>[number];

/** Every assignment of the given crew members, on any mission, with the mission as a reason names it. */
export function listAssignmentsOfCrew({ tx, orgId }: TenantContext, crewMemberIds: string[]) {
  return tx
    .select({
      crewMemberId: assignments.crewMemberId,
      ref: assignments.ref,
      period: assignments.period,
      status: assignments.status,
      mission: { ref: missions.ref, name: missions.name, status: missions.status },
      missionOwner: owners.name,
    })
    .from(assignments)
    .innerJoin(missions, and(eq(missions.orgId, assignments.orgId), eq(missions.id, assignments.missionId)))
    .innerJoin(owners, and(eq(owners.orgId, missions.orgId), eq(owners.id, missions.ownerId)))
    .where(and(eq(assignments.orgId, orgId), inArray(assignments.crewMemberId, crewMemberIds)))
    .orderBy(asc(assignments.ref));
}

/** A new assignment, placed by the caller: from a match run when `matchRunId` is set, by hand when it is null. */
export async function insertAssignment(
  { tx, orgId, userId }: TenantContext,
  values: {
    ref: number;
    missionId: string;
    requirementId: string;
    crewMemberId: string;
    period: Period;
    status: AssignmentStatus;
    score: number;
    matchRunId: string | null;
  },
) {
  await tx.insert(assignments).values({ orgId, createdBy: userId, ...values });
}

/** An assignment, with its mission and slot, and the user its crew member logs in as. */
export async function findAssignmentByRef({ tx, orgId }: TenantContext, ref: number) {
  const [assignment] = await tx
    .select({
      id: assignments.id,
      ref: assignments.ref,
      status: assignments.status,
      missionRef: missions.ref,
      missionName: missions.name,
      missionPeriod: missions.period,
      skill: skills.name,
      crewMemberUserId: crewMembers.userId,
    })
    .from(assignments)
    .innerJoin(missions, and(eq(missions.orgId, assignments.orgId), eq(missions.id, assignments.missionId)))
    .innerJoin(
      missionRequirements,
      and(eq(missionRequirements.orgId, assignments.orgId), eq(missionRequirements.id, assignments.requirementId)),
    )
    .innerJoin(skills, and(eq(skills.orgId, missionRequirements.orgId), eq(skills.id, missionRequirements.skillId)))
    .innerJoin(crewMembers, and(eq(crewMembers.orgId, assignments.orgId), eq(crewMembers.id, assignments.crewMemberId)))
    .where(and(eq(assignments.orgId, orgId), eq(assignments.ref, ref)));
  return assignment;
}

/**
 * Moves one assignment to another status, only if it still has one of the statuses expected. False
 * when it no longer does, because another request moved it first. Only a decline gives a reason;
 * no status moves on from declined, so no reason is lost.
 */
export async function moveAssignment(
  { tx, orgId }: TenantContext,
  id: string,
  from: readonly AssignmentStatus[],
  to: AssignmentStatus,
  declineReason: string | null = null,
): Promise<boolean> {
  const moved = await tx
    .update(assignments)
    .set({ status: to, declineReason })
    .where(and(eq(assignments.orgId, orgId), eq(assignments.id, id), inArray(assignments.status, [...from])))
    .returning({ id: assignments.id });
  return moved.length > 0;
}
