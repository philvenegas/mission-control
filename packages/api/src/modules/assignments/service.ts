import {
  type AssignCrew,
  type AssignmentStatus,
  CREW_VISIBLE_ASSIGNMENT_STATUSES,
  type CrewAssignment,
  formatRef,
  type Mission,
  PLACED_ASSIGNMENT_STATUSES,
} from '@mission-control/contract';
import { assessCandidate } from '@mission-control/matcher';
import { reaches } from '../../auth/policy.ts';
import { refNumber, takeNextRef } from '../../db/refs.ts';
import { exactlyOne } from '../../db/rows.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { DomainError, forbidden, notFound } from '../../errors.ts';
import { resolveCrewMember } from '../crew/service.ts';
import { crewInputs, matchedMission, requirementInputs } from '../matching/candidates.ts';
import { describeFailure, nameCrewMember } from '../matching/reasons.ts';
import { toFailureResponse } from '../matching/result.ts';
import { getMissionByRef, listRequirements, listStaffedMissions, type MissionRow, moveAssignments } from '../missions/repository.ts';
import { describeMission, lockMissionForCrewChange, resolveMissionForCrewChange } from '../missions/service.ts';
import { getOrganisation } from '../org/repository.ts';
import { getSkill } from '../skills/service.ts';
import { findAssignmentByRef, insertAssignment, listMissionCrew, moveAssignment } from './repository.ts';

/** A crew member placed on a draft is proposed; one placed on an approved mission, refilling a slot, is offered. */
const placedStatus = (mission: MissionRow): AssignmentStatus => (mission.status === 'draft' ? 'proposed' : 'offered');

/** Puts a crew member in one of a mission's slots, from a match run or by hand. The caller holds the mission's row lock, and its status lets its crew change. */
export async function placeCrewMember(
  context: TenantContext,
  mission: MissionRow,
  assignment: { requirementId: string; crewMemberId: string; score: number; matchRunId: string | null },
) {
  const ref = await takeNextRef(context, 'assignment');
  await insertAssignment(context, { ref, missionId: mission.id, period: mission.period, status: placedStatus(mission), ...assignment });
}

/**
 * Assigns a named crew member to an open slot by hand. The same hard constraints apply as in the
 * matcher, with the same reasons, and nobody can override them: the record that blocks the crew
 * member is changed instead.
 */
export async function assignByHand(context: TenantContext, missionRef: string, input: AssignCrew): Promise<Mission> {
  const mission = await resolveMissionForCrewChange(context, missionRef);
  const skill = await getSkill(context, input.skill);
  const crewMember = await resolveCrewMember(context, input.crew_member, 'crew:read');
  const [requirements, missionCrew] = await Promise.all([listRequirements(context, [mission.id]), listMissionCrew(context, [mission.id])]);
  const requirement = requirementInputs(requirements, missionCrew).find((each) => each.skill === skill.name);
  if (!requirement) throw notFound(`${missionRef}'s ${skill.name} requirement`);
  if (requirement.filled >= requirement.headcount) {
    throw new DomainError(
      'NO_OPEN_SLOT',
      `${missionRef}'s ${skill.name} slots are all filled (${requirement.filled} of ${requirement.headcount}).`,
      'Release one of its crew first, or raise its headcount.',
    );
  }

  const candidate = exactlyOne(await crewInputs(context, [crewMember]), 'crew member');
  const { settings } = await getOrganisation(context);
  const { failures, score } = assessCandidate({ crew: candidate, need: requirement, mission: matchedMission(mission) }, settings.match_weights);
  // A score is given exactly when no hard constraint fails.
  if (score === null) {
    const reasons = failures.map((failure) => describeFailure(candidate, skill.name, toFailureResponse(failure)));
    throw new DomainError(
      'HARD_CONSTRAINT_FAILED',
      `${nameCrewMember(candidate)} cannot be assigned as ${skill.name} on ${missionRef}: ${reasons.join('; ')}.`,
      'Nobody can assign against a hard constraint. Change the record that blocks it instead.',
    );
  }
  await placeCrewMember(context, mission, { requirementId: requirement.id, crewMemberId: candidate.id, score: score.total, matchRunId: null });
  return describeMission(context, mission);
}

/** An assignment whose crew the caller may change: one on a mission they own, or any for a director. */
async function resolveAssignmentForCrewChange(context: TenantContext, assignmentRef: string) {
  const assignment = await findAssignmentByRef(context, refNumber('assignment', assignmentRef));
  if (!assignment) throw notFound(assignmentRef);
  const visible = await getMissionByRef(context, assignment.missionRef);
  const missionRef = formatRef('mission', visible.ref);
  if (!reaches(context, 'missions:assign-crew', visible.ownerId)) throw forbidden(`Only ${missionRef}'s owner or a director can change its crew.`);
  return { assignment, mission: await lockMissionForCrewChange(context, visible) };
}

/**
 * Releases one crew member from their slot, which reopens it. A declined assignment stays as it is:
 * it records that the crew member said no to this mission.
 */
export async function releaseAssignment(context: TenantContext, assignmentRef: string): Promise<Mission> {
  const { assignment, mission } = await resolveAssignmentForCrewChange(context, assignmentRef);
  if (!(await moveAssignment(context, assignment.id, PLACED_ASSIGNMENT_STATUSES, 'released'))) {
    throw new DomainError('WRONG_ASSIGNMENT_STATUS', `${assignmentRef} is ${assignment.status}, so it cannot be released.`);
  }
  return describeMission(context, mission);
}

/** Releases every proposal on a draft, to start its crew over. */
export async function clearProposals(context: TenantContext, missionRef: string): Promise<Mission> {
  const mission = await resolveMissionForCrewChange(context, missionRef);
  if (mission.status !== 'draft') {
    throw new DomainError('NOT_DRAFT', `${missionRef} is ${mission.status}, so it has no proposals to clear.`, 'Release its crew one at a time instead.');
  }
  await moveAssignments(context, mission.id, ['proposed'], 'released');
  return describeMission(context, mission);
}

/** The caller's own offered and accepted assignments. */
export async function listOwnAssignments(context: TenantContext): Promise<CrewAssignment[]> {
  return (await listStaffedMissions(context, context.userId)).map((row) => ({
    ref: formatRef('assignment', row.assignmentRef),
    mission: { ref: formatRef('mission', row.ref), name: row.name, from: row.period.from, to: row.period.to },
    skill: row.skill,
    status: row.assignmentStatus,
  }));
}

/**
 * A crew member accepting or declining their own offered assignment. One that is not theirs, or that
 * they cannot see (proposed or held), is not found.
 */
export async function respondToAssignment(
  context: TenantContext,
  assignmentRef: string,
  response: { to: 'accepted' } | { to: 'declined'; reason: string | null },
): Promise<CrewAssignment> {
  const assignment = await findAssignmentByRef(context, refNumber('assignment', assignmentRef));
  const visible = (status: AssignmentStatus) => CREW_VISIBLE_ASSIGNMENT_STATUSES.some((each) => each === status);
  if (!assignment || !reaches(context, 'assignments:respond', assignment.crewMemberUserId) || !visible(assignment.status)) {
    throw notFound(assignmentRef);
  }
  const reason = response.to === 'declined' ? response.reason : null;
  if (!(await moveAssignment(context, assignment.id, ['offered'], response.to, reason))) {
    throw new DomainError('WRONG_ASSIGNMENT_STATUS', `${assignmentRef} is ${assignment.status}; only an offered assignment can be ${response.to}.`);
  }
  return {
    ref: assignmentRef,
    mission: { ref: formatRef('mission', assignment.missionRef), name: assignment.missionName, from: assignment.missionPeriod.from, to: assignment.missionPeriod.to },
    skill: assignment.skill,
    status: response.to,
  };
}
