import {
  type CreateMission,
  type CrewMission,
  formatRef,
  type Mission,
  type MissionEvent,
  type MissionStatus,
  type SetRequirement,
  type Transition,
  type UpdateMission,
} from '@mission-control/contract';
import { can, type Permission, reaches, scopeOf } from '../../auth/policy.ts';
import { exactlyOne } from '../../db/rows.ts';
import { refNumber, takeNextRef } from '../../db/refs.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { DomainError, forbidden, notFound } from '../../errors.ts';
import { getOrganisation } from '../org/repository.ts';
import { getSkill } from '../skills/service.ts';
import { TRANSITION_TABLE } from './lifecycle.ts';
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
  moveMission,
  updateMission,
  upsertRequirement,
} from './repository.ts';

/** Whether the caller reads missions as a crew member does: only those they are offered or accepted on. */
const readsOwnMissions = (context: TenantContext) => scopeOf(context.role, 'missions:read') === 'own';

async function toMissions(context: TenantContext, rows: MissionRow[]): Promise<Mission[]> {
  const ids = rows.map((row) => row.id);
  const [requirements, decisions, { settings }] = await Promise.all([
    listRequirements(context, ids),
    listCurrentDecisions(context, ids),
    getOrganisation(context),
  ]);
  return rows.map((row) => ({
    ref: formatRef('mission', row.ref),
    name: row.name,
    description: row.description,
    from: row.period.from,
    to: row.period.to,
    status: row.status,
    owner: row.owner,
    submitted_by: row.submitterName === null || row.submitterEmail === null ? null : { name: row.submitterName, email: row.submitterEmail },
    requirements: requirements
      .filter((requirement) => requirement.missionId === row.id)
      .map((requirement) => ({ skill: requirement.skill, min_level: requirement.minLevel, headcount: requirement.headcount })),
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
async function describeMission(context: TenantContext, mission: MissionRow): Promise<Mission> {
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

/** How a refusal names a transition that has happened: "it cannot be submitted". */
const DONE: Record<Transition, string> = {
  submit: 'submitted',
  withdraw: 'withdrawn',
  approve: 'approved',
  reject: 'rejected',
  launch: 'launched',
  complete: 'completed',
  cancel: 'cancelled',
};

/**
 * Makes a transition, as the transition table says: from the statuses it allows, by those it
 * permits, when its guard holds. The status changes only if it is still the one the guard saw, and
 * the event is written in the same transaction. Every status change goes through here.
 */
export async function makeTransition(context: TenantContext, missionRef: string, transition: Transition, note: string | null): Promise<Mission> {
  const found = await resolveMission(context, missionRef);
  // One transition on a mission at a time: a second waits, then sees what the first did.
  await lockMission(context, found.id);
  const mission = await getMissionByRef(context, found.ref);

  const rule = TRANSITION_TABLE.find((candidate) => candidate.transition === transition && candidate.from.includes(mission.status));
  if (!rule) throw transitionNotAllowed(missionRef, mission.status, transition);
  if (!reaches(context, rule.permission, mission.ownerId)) {
    throw forbidden(
      can(context.role, rule.permission)
        ? `Only ${missionRef}'s owner or a director can ${transition} it.`
        : `Only a director can ${transition} ${missionRef} now that it is ${mission.status}.`,
    );
  }

  const run = { context, mission, note };
  await rule.guard?.(run);
  const moves = rule.decide ? await rule.decide(run) : true;
  const to = moves ? rule.to : mission.status;
  if (moves) {
    if (!(await moveMission(context, mission.id, mission.status, rule.to))) throw transitionNotAllowed(missionRef, mission.status, transition);
    await rule.effect?.(run);
  }
  await insertEvent(context, { missionId: mission.id, type: transition, fromStatus: mission.status, toStatus: to, note });
  return describeMission(context, mission);
}

const transitionNotAllowed = (missionRef: string, status: MissionStatus, transition: Transition) =>
  new DomainError('TRANSITION_NOT_ALLOWED', `${missionRef} is ${status}, so it cannot be ${DONE[transition]}.`);
