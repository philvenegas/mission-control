import { formatRef, PLACED_ASSIGNMENT_STATUSES } from '@mission-control/contract';
import type { CrewInput, MatchedMission, RequirementInput } from '@mission-control/matcher';
import type { TenantContext } from '../../db/tenant.ts';
import { listAssignmentsOfCrew, type MissionCrewRow } from '../assignments/repository.ts';
import { listAvailabilityBlocksOf } from '../availability/repository.ts';
import { type CrewMemberRow, listCrewSkills } from '../crew/repository.ts';
import type { MissionRow } from '../missions/repository.ts';

// What the matcher is given, gathered from the database: the mission, its requirements with how
// many of their slots are filled, and each crew member's skills, availability and assignments.

export const matchedMission = (mission: MissionRow): MatchedMission => ({
  ref: formatRef('mission', mission.ref),
  status: mission.status,
  period: mission.period,
});

/** Whether an assignment puts its crew member in a slot: proposed, held, offered or accepted. */
const isPlaced = (crew: MissionCrewRow) => PLACED_ASSIGNMENT_STATUSES.some((status) => status === crew.status);

/** A mission's requirements, each with how many of its slots crew already fill. */
export const requirementInputs = (
  requirements: { id: string; skill: string; minLevel: number; headcount: number }[],
  missionCrew: MissionCrewRow[],
): (RequirementInput & { id: string })[] =>
  requirements.map((requirement) => ({
    id: requirement.id,
    skill: requirement.skill,
    minLevel: requirement.minLevel,
    headcount: requirement.headcount,
    filled: missionCrew.filter((crew) => crew.requirementId === requirement.id && isPlaced(crew)).length,
  }));

/** The crew members, as the matcher weighs them: their skills, availability blocks and every assignment. */
export async function crewInputs(context: TenantContext, crew: CrewMemberRow[]): Promise<(CrewInput & { id: string })[]> {
  const ids = crew.map((crewMember) => crewMember.id);
  const [skills, blocks, assignments] = await Promise.all([
    listCrewSkills(context, ids),
    listAvailabilityBlocksOf(context, ids),
    listAssignmentsOfCrew(context, ids),
  ]);
  return crew.map((crewMember) => ({
    id: crewMember.id,
    ref: formatRef('crew_member', crewMember.ref),
    name: crewMember.name,
    status: crewMember.status,
    skills: skills
      .filter((skill) => skill.crewMemberId === crewMember.id)
      .map((skill) => ({ skill: skill.skill, level: skill.level, certifiedUntil: skill.certifiedUntil })),
    availabilityBlocks: blocks
      .filter((block) => block.crewMemberId === crewMember.id)
      .map((block) => ({ ref: formatRef('availability_block', block.ref), period: block.period })),
    assignments: assignments
      .filter((assignment) => assignment.crewMemberId === crewMember.id)
      .map((assignment) => ({
        ref: formatRef('assignment', assignment.ref),
        mission: {
          ref: formatRef('mission', assignment.mission.ref),
          name: assignment.mission.name,
          status: assignment.mission.status,
          owner: assignment.missionOwner,
        },
        period: assignment.period,
        status: assignment.status,
      })),
  }));
}
