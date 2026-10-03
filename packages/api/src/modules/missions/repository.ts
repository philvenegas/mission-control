import {
  type ApprovalDecision,
  type AssignmentStatus,
  CREW_VISIBLE_ASSIGNMENT_STATUSES,
  type MissionEventType,
  type MissionStatus,
  type Period,
} from '@mission-control/contract';
import { and, asc, count, eq, inArray, ne, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { exactlyOne } from '../../db/rows.ts';
import { assignments, crewMembers, missionApprovals, missionEvents, missionRequirements, missions, skills, users } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

const owners = alias(users, 'owners');
const submitters = alias(users, 'submitters');

function selectMissions({ tx, orgId }: TenantContext, condition?: SQL) {
  return tx
    .select({
      id: missions.id,
      ref: missions.ref,
      name: missions.name,
      description: missions.description,
      period: missions.period,
      status: missions.status,
      ownerId: missions.ownerId,
      owner: { name: owners.name, email: owners.email },
      submittedById: missions.submittedBy,
      submittedBy: { name: submitters.name, email: submitters.email },
      submissionNo: missions.submissionNo,
    })
    .from(missions)
    .innerJoin(owners, and(eq(owners.orgId, missions.orgId), eq(owners.id, missions.ownerId)))
    .leftJoin(submitters, and(eq(submitters.orgId, missions.orgId), eq(submitters.id, missions.submittedBy)))
    .where(and(eq(missions.orgId, orgId), condition))
    .orderBy(asc(missions.ref));
}

export type MissionRow = Awaited<ReturnType<typeof selectMissions>>[number];

/** Every mission of the organisation, by reference. */
export function listMissions(context: TenantContext): Promise<MissionRow[]> {
  return selectMissions(context);
}

export async function findMissionByRef(context: TenantContext, ref: number): Promise<MissionRow | undefined> {
  const [mission] = await selectMissions(context, eq(missions.ref, ref));
  return mission;
}

/** A mission that must exist, such as one just created. */
export async function getMissionByRef(context: TenantContext, ref: number): Promise<MissionRow> {
  return exactlyOne(await selectMissions(context, eq(missions.ref, ref)), 'mission');
}

/**
 * Locks a mission's row until the request's transaction ends, so two transitions on one mission
 * run one after the other and the second sees what the first did.
 */
export async function lockMission({ tx, orgId }: TenantContext, id: string): Promise<void> {
  await tx.execute(sql`SELECT 1 FROM ${missions} WHERE ${missions.orgId} = ${orgId} AND ${missions.id} = ${id} FOR UPDATE`);
}

/** The missions a user's crew record is offered or accepted on, each with that one assignment. */
export function listStaffedMissions({ tx, orgId }: TenantContext, userId: string, missionRef?: number) {
  return tx
    .select({
      ref: missions.ref,
      name: missions.name,
      period: missions.period,
      assignmentRef: assignments.ref,
      skill: skills.name,
      assignmentStatus: assignments.status,
    })
    .from(assignments)
    .innerJoin(crewMembers, and(eq(crewMembers.orgId, assignments.orgId), eq(crewMembers.id, assignments.crewMemberId)))
    .innerJoin(missions, and(eq(missions.orgId, assignments.orgId), eq(missions.id, assignments.missionId)))
    .innerJoin(
      missionRequirements,
      and(eq(missionRequirements.orgId, assignments.orgId), eq(missionRequirements.id, assignments.requirementId)),
    )
    .innerJoin(skills, and(eq(skills.orgId, missionRequirements.orgId), eq(skills.id, missionRequirements.skillId)))
    .where(
      and(
        eq(assignments.orgId, orgId),
        eq(crewMembers.userId, userId),
        inArray(assignments.status, [...CREW_VISIBLE_ASSIGNMENT_STATUSES]),
        missionRef === undefined ? undefined : eq(missions.ref, missionRef),
      ),
    )
    .orderBy(asc(missions.ref));
}

export async function insertMission(
  { tx, orgId }: TenantContext,
  values: { ref: number; name: string; description: string; period: Period; ownerId: string },
) {
  await tx.insert(missions).values({ orgId, ...values });
}

/** Changes a mission's details. A new period reaches its assignments through their foreign key. */
export async function updateMission(
  { tx, orgId }: TenantContext,
  id: string,
  changes: { name?: string; description?: string; period?: Period },
) {
  await tx.update(missions).set(changes).where(and(eq(missions.orgId, orgId), eq(missions.id, id)));
}

/** The requirements of each of the given missions, by skill name. */
export function listRequirements({ tx, orgId }: TenantContext, missionIds: string[]) {
  return tx
    .select({
      id: missionRequirements.id,
      missionId: missionRequirements.missionId,
      skill: skills.name,
      minLevel: missionRequirements.minLevel,
      headcount: missionRequirements.headcount,
    })
    .from(missionRequirements)
    .innerJoin(skills, and(eq(skills.orgId, missionRequirements.orgId), eq(skills.id, missionRequirements.skillId)))
    .where(and(eq(missionRequirements.orgId, orgId), inArray(missionRequirements.missionId, missionIds)))
    .orderBy(asc(skills.name));
}

export type RequirementRow = Awaited<ReturnType<typeof listRequirements>>[number];

export async function upsertRequirement(
  { tx, orgId }: TenantContext,
  values: { missionId: string; skillId: string; minLevel: number; headcount: number },
) {
  await tx
    .insert(missionRequirements)
    .values({ orgId, ...values })
    .onConflictDoUpdate({
      target: [missionRequirements.missionId, missionRequirements.skillId],
      set: { minLevel: values.minLevel, headcount: values.headcount },
    });
}

export async function findRequirement({ tx, orgId }: TenantContext, missionId: string, skillId: string) {
  const [requirement] = await tx
    .select({ id: missionRequirements.id })
    .from(missionRequirements)
    .where(and(eq(missionRequirements.orgId, orgId), eq(missionRequirements.missionId, missionId), eq(missionRequirements.skillId, skillId)));
  return requirement;
}

export async function deleteRequirement({ tx, orgId }: TenantContext, id: string) {
  await tx.delete(missionRequirements).where(and(eq(missionRequirements.orgId, orgId), eq(missionRequirements.id, id)));
}

/** How many of a requirement's assignments are not released: the crew planned or placed in it. */
export async function countCrewInRequirement({ tx, orgId }: TenantContext, requirementId: string): Promise<number> {
  const rows = await tx
    .select({ crew: count() })
    .from(assignments)
    .where(and(eq(assignments.orgId, orgId), eq(assignments.requirementId, requirementId), ne(assignments.status, 'released')));
  return exactlyOne(rows, 'count').crew;
}

/** For each requirement of a mission, how many of its assignments have a given status. */
export function countAssignmentsByRequirement({ tx, orgId }: TenantContext, missionId: string, status: AssignmentStatus) {
  return tx
    .select({ skill: skills.name, headcount: missionRequirements.headcount, crew: count(assignments.id) })
    .from(missionRequirements)
    .innerJoin(skills, and(eq(skills.orgId, missionRequirements.orgId), eq(skills.id, missionRequirements.skillId)))
    .leftJoin(
      assignments,
      and(eq(assignments.orgId, missionRequirements.orgId), eq(assignments.requirementId, missionRequirements.id), eq(assignments.status, status)),
    )
    .where(and(eq(missionRequirements.orgId, orgId), eq(missionRequirements.missionId, missionId)))
    .groupBy(skills.name, missionRequirements.headcount)
    .orderBy(asc(skills.name));
}

/**
 * The decisions directors have made on the current submission of each of the given missions, with
 * who made them, earliest first. Decisions on an earlier submission no longer count.
 */
export function listCurrentDecisions({ tx, orgId }: TenantContext, missionIds: string[]) {
  return tx
    .select({
      missionId: missionApprovals.missionId,
      approverId: missionApprovals.approverId,
      decision: missionApprovals.decision,
      approver: { name: users.name, email: users.email },
    })
    .from(missionApprovals)
    .innerJoin(
      missions,
      and(
        eq(missions.orgId, missionApprovals.orgId),
        eq(missions.id, missionApprovals.missionId),
        eq(missions.submissionNo, missionApprovals.submissionNo),
      ),
    )
    .innerJoin(users, and(eq(users.orgId, missionApprovals.orgId), eq(users.id, missionApprovals.approverId)))
    .where(and(eq(missionApprovals.orgId, orgId), inArray(missionApprovals.missionId, missionIds)))
    .orderBy(asc(missionApprovals.createdAt));
}

export async function insertDecision(
  { tx, orgId, userId }: TenantContext,
  values: { missionId: string; submissionNo: number; decision: ApprovalDecision; note: string | null },
) {
  await tx.insert(missionApprovals).values({ orgId, approverId: userId, ...values });
}

/** How many directors of the organisation there are other than the given user. */
export async function countDirectorsOtherThan({ tx, orgId }: TenantContext, userId: string): Promise<number> {
  const rows = await tx
    .select({ directors: count() })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, 'director'), ne(users.id, userId)));
  return exactlyOne(rows, 'count').directors;
}

/**
 * Moves a mission from one status to another, only if it still has the status expected. False when
 * it no longer does, because another request moved it first.
 */
export async function moveMission({ tx, orgId }: TenantContext, id: string, from: MissionStatus, to: MissionStatus): Promise<boolean> {
  const moved = await tx
    .update(missions)
    .set({ status: to })
    .where(and(eq(missions.orgId, orgId), eq(missions.id, id), eq(missions.status, from)))
    .returning({ id: missions.id });
  return moved.length > 0;
}

/** Starts a new submission of a mission, made by the caller. Decisions on earlier ones stop counting. */
export async function startSubmission({ tx, orgId, userId }: TenantContext, id: string) {
  await tx
    .update(missions)
    .set({ submittedBy: userId, submissionNo: sql`${missions.submissionNo} + 1` })
    .where(and(eq(missions.orgId, orgId), eq(missions.id, id)));
}

/** Moves a mission's assignments that have one of the given statuses to another. */
export async function moveAssignments(
  { tx, orgId }: TenantContext,
  missionId: string,
  from: readonly AssignmentStatus[],
  to: AssignmentStatus,
) {
  await tx
    .update(assignments)
    .set({ status: to })
    .where(and(eq(assignments.orgId, orgId), eq(assignments.missionId, missionId), inArray(assignments.status, [...from])));
}

export async function insertEvent(
  { tx, orgId, userId }: TenantContext,
  values: { missionId: string; type: MissionEventType; fromStatus: MissionStatus | null; toStatus: MissionStatus | null; note: string | null },
) {
  await tx.insert(missionEvents).values({ orgId, actorId: userId, ...values });
}

/** A mission's history, oldest first. */
export function listEvents({ tx, orgId }: TenantContext, missionId: string) {
  return tx
    .select({
      type: missionEvents.type,
      fromStatus: missionEvents.fromStatus,
      toStatus: missionEvents.toStatus,
      actor: { name: users.name, email: users.email },
      note: missionEvents.note,
      createdAt: missionEvents.createdAt,
    })
    .from(missionEvents)
    .innerJoin(users, and(eq(users.orgId, missionEvents.orgId), eq(users.id, missionEvents.actorId)))
    .where(and(eq(missionEvents.orgId, orgId), eq(missionEvents.missionId, missionId)))
    .orderBy(asc(missionEvents.createdAt), asc(missionEvents.id));
}
