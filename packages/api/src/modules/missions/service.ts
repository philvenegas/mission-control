import {
  type CreateMission,
  type CrewMemberSummary,
  type CrewMission,
  formatRef,
  isStaffableStatus,
  type Mission,
  type MissionCrew,
  type MissionEvent,
  type SetRequirement,
  type Transition,
  type UpdateMission,
} from '@mission-control/contract';
import { type Permission, reaches, scopeOf } from '../../auth/policy.ts';
import { exactlyOne } from '../../db/rows.ts';
import { refNumber, takeNextRef } from '../../db/refs.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { DomainError, forbidden, notFound } from '../../errors.ts';
import { listMissionCrew } from '../assignments/repository.ts';
import { type CheckedCrew, checkProposals } from './proposals.ts';
import { getOrganisation } from '../org/repository.ts';
import { getSkill } from '../skills/service.ts';
import { runTransition } from './lifecycle.ts';
import {
  countCrewInRequirement,
  deleteRequirement,
  findMissionByRef,
  findRequirement,
  getMissionByRef,
  insertEvent,
  insertMission,
  listCurrentDecisions,
  listEvents,
  listMissions,
  listRequirements,
  listStaffedMissions,
  lockMission,
  type MissionRow,
  updateMission,
  upsertRequirement,
} from './repository.ts';

/** Whether the caller reads missions as a crew member does: only those they are offered or accepted on. */
const readsOwnMissions = (context: TenantContext) => scopeOf(context.role, 'missions:read') === 'own';

const toMissionCrew = (assignment: CheckedCrew): MissionCrew => ({
  assignment: formatRef('assignment', assignment.ref),
  crew_member: { ref: formatRef('crew_member', assignment.crewMember.ref), name: assignment.crewMember.name },
  status: assignment.status,
  score: assignment.score,
  match_run: assignment.matchRunRef === null ? null : formatRef('match_run', assignment.matchRunRef),
  assigned_by: assignment.assignedBy,
  decline_reason: assignment.declineReason,
  problems: assignment.problems,
});

async function toMissions(context: TenantContext, rows: MissionRow[]): Promise<Mission[]> {
  const ids = rows.map((row) => row.id);
  const [requirements, missionCrew, decisions, { settings }] = await Promise.all([
    listRequirements(context, ids),
    listMissionCrew(context, ids),
    listCurrentDecisions(context, ids),
    getOrganisation(context),
  ]);
  const crew = await checkProposals(context, { missions: rows, requirements, missionCrew, weights: settings.match_weights });
  return rows.map((row) => ({
    ref: formatRef('mission', row.ref),
    name: row.name,
    description: row.description,
    from: row.period.from,
    to: row.period.to,
    status: row.status,
    owner: row.owner,
    submitted_by: row.submittedBy,
    requirements: requirements
      .filter((requirement) => requirement.missionId === row.id)
      .map((requirement) => ({
        skill: requirement.skill,
        min_level: requirement.minLevel,
        headcount: requirement.headcount,
        crew: crew.filter((assignment) => assignment.requirementId === requirement.id).map(toMissionCrew),
      })),
    approval: {
      required: settings.approvals_required,
      approved_by:
        row.status === 'draft'
          ? []
          : decisions
              .filter((decision) => decision.missionId === row.id && decision.decision === 'approve')
              .map((decision) => decision.approver),
    },
  }));
}

const toCrewMissions = (rows: Awaited<ReturnType<typeof listStaffedMissions>>): CrewMission[] =>
  rows.map((row) => ({
    ref: formatRef('mission', row.ref),
    name: row.name,
    from: row.period.from,
    to: row.period.to,
    slot: { assignment: formatRef('assignment', row.assignmentRef), skill: row.skill, status: row.assignmentStatus },
  }));

/**
 * The mission a reference names, if the caller may see it. A crew member sees only a mission they
 * are offered or accepted on; any other answers as if it did not exist.
 */
async function resolveMission(context: TenantContext, missionRef: string): Promise<MissionRow> {
  const mission = await findMissionByRef(context, refNumber('mission', missionRef));
  if (!mission || (readsOwnMissions(context) && (await listStaffedMissions(context, context.userId, mission.ref)).length === 0)) {
    throw notFound(missionRef);
  }
  return mission;
}

/**
 * The mission, if the caller may act on it under the permission. One they may see but not act on
 * is refused with 403: they know it exists.
 */
async function resolveMissionToAct(context: TenantContext, missionRef: string, permission: Permission, refusal: string) {
  const mission = await resolveMission(context, missionRef);
  if (!reaches(context, permission, mission.ownerId)) throw forbidden(refusal);
  return mission;
}

export async function listMissionsFor(context: TenantContext): Promise<Mission[] | CrewMission[]> {
  if (readsOwnMissions(context)) return toCrewMissions(await listStaffedMissions(context, context.userId));
  return toMissions(context, await listMissions(context));
}

export async function showMission(context: TenantContext, missionRef: string): Promise<Mission | CrewMission> {
  const mission = await resolveMission(context, missionRef);
  if (readsOwnMissions(context)) {
    return exactlyOne(toCrewMissions(await listStaffedMissions(context, context.userId, mission.ref)), 'staffed mission');
  }
  return describeMission(context, mission);
}

/** The full view of a mission, read afresh. */
export async function describeMission(context: TenantContext, mission: MissionRow): Promise<Mission> {
  return exactlyOne(await toMissions(context, [await getMissionByRef(context, mission.ref)]), 'mission');
}

export async function createMission(context: TenantContext, input: CreateMission): Promise<Mission> {
  const ref = await takeNextRef(context, 'mission');
  await insertMission(context, {
    ref,
    name: input.name,
    description: input.description ?? '',
    period: { from: input.from, to: input.to },
    ownerId: context.userId,
  });
  return describeMission(context, await getMissionByRef(context, ref));
}

/**
 * Locks a mission whose crew the caller is about to change, so two changes to it run one after the
 * other, and gives it as it now is. Refused unless the caller may change its crew (403: they can see
 * the mission) and its status lets its crew change.
 */
export async function lockMissionForCrewChange(context: TenantContext, visible: MissionRow): Promise<MissionRow> {
  const ref = formatRef('mission', visible.ref);
  if (!reaches(context, 'missions:assign-crew', visible.ownerId)) throw forbidden(`Only ${ref}'s owner or a director can change its crew.`);
  await lockMission(context, visible.id);
  const mission = await getMissionByRef(context, visible.ref);
  if (!isStaffableStatus(mission.status)) {
    throw new DomainError(
      'NOT_STAFFABLE',
      `${ref} is ${mission.status}, so its crew cannot change.`,
      'Crew change while a mission is a draft, or to refill a slot once it is approved.',
    );
  }
  return mission;
}

/**
 * Writes into each other draft's history that a crew member it proposes is now proposed on this
 * mission too: a clash (DESIGN.md section 4). The event's actor is whoever made the proposal.
 */
export async function recordClashes(context: TenantContext, mission: MissionRow, crewMember: CrewMemberSummary, clashes: { ref: string }[]) {
  for (const other of clashes) {
    const { id } = await getMissionByRef(context, refNumber('mission', other.ref));
    await insertEvent(context, {
      missionId: id,
      type: 'clash',
      fromStatus: null,
      toStatus: null,
      note: `${crewMember.name} ${crewMember.ref} is now also proposed on ${formatRef('mission', mission.ref)} ${mission.name}.`,
    });
  }
}

/** A mission whose crew the caller may change, with its row lock taken for the change. */
export async function resolveMissionForCrewChange(context: TenantContext, missionRef: string): Promise<MissionRow> {
  return lockMissionForCrewChange(context, await resolveMission(context, missionRef));
}

/** A draft the caller may edit. Any other status is refused: what is approved is what was submitted. */
async function resolveDraftToEdit(context: TenantContext, missionRef: string): Promise<MissionRow> {
  const mission = await resolveMissionToAct(context, missionRef, 'missions:edit', `Only ${missionRef}'s owner or a director can change it.`);
  if (mission.status !== 'draft') {
    throw new DomainError('NOT_DRAFT', `${missionRef} is ${mission.status}, so it can no longer be changed.`, 'Only a draft can be changed.');
  }
  return mission;
}

export async function changeMission(context: TenantContext, missionRef: string, changes: UpdateMission): Promise<Mission> {
  const mission = await resolveDraftToEdit(context, missionRef);
  await updateMission(context, mission.id, {
    name: changes.name,
    description: changes.description,
    period: changes.from === undefined || changes.to === undefined ? undefined : { from: changes.from, to: changes.to },
  });
  return describeMission(context, mission);
}

export async function setRequirement(context: TenantContext, missionRef: string, skillName: string, input: SetRequirement): Promise<Mission> {
  const mission = await resolveDraftToEdit(context, missionRef);
  const skill = await getSkill(context, skillName);
  const headcount = input.headcount ?? 1;
  const existing = await findRequirement(context, mission.id, skill.id);
  const crew = existing ? await countCrewInRequirement(context, existing.id) : 0;
  if (crew > headcount) {
    throw new DomainError(
      'REQUIREMENT_STAFFED',
      `${missionRef} has ${crew} crew proposed as ${skill.name}, so its headcount cannot go below ${crew}.`,
      'Remove proposed crew first, or keep the headcount.',
    );
  }
  await upsertRequirement(context, { missionId: mission.id, skillId: skill.id, minLevel: input.min_level, headcount });
  return describeMission(context, mission);
}

export async function removeRequirement(context: TenantContext, missionRef: string, skillName: string): Promise<Mission> {
  const mission = await resolveDraftToEdit(context, missionRef);
  const skill = await getSkill(context, skillName);
  const requirement = await findRequirement(context, mission.id, skill.id);
  if (!requirement) throw notFound(`${missionRef}'s ${skill.name} requirement`);
  const crew = await countCrewInRequirement(context, requirement.id);
  if (crew > 0) {
    throw new DomainError(
      'REQUIREMENT_STAFFED',
      `${missionRef} has ${crew} crew proposed as ${skill.name}.`,
      'Remove the proposed crew first, then the requirement.',
    );
  }
  await deleteRequirement(context, requirement.id);
  return describeMission(context, mission);
}

export async function missionHistory(context: TenantContext, missionRef: string): Promise<MissionEvent[]> {
  const mission = await resolveMissionToAct(context, missionRef, 'missions:history', `Only ${missionRef}'s owner or a director can read its history.`);
  return (await listEvents(context, mission.id)).map((event) => ({
    type: event.type,
    from_status: event.fromStatus,
    to_status: event.toStatus,
    actor: event.actor,
    note: event.note,
    at: event.createdAt.toISOString(),
  }));
}

/** Makes a transition on a mission the caller can see, by the transition table, and gives the mission as it now is. */
export async function makeTransition(context: TenantContext, missionRef: string, transition: Transition, note: string | null): Promise<Mission> {
  const mission = await resolveMission(context, missionRef);
  await runTransition(context, mission, transition, note);
  return describeMission(context, mission);
}
