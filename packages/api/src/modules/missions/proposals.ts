import { formatRef, type MatchWeights, type Problem } from '@mission-control/contract';
import { assessCandidate, type MissionSummary } from '@mission-control/matcher';
import { exactlyOne } from '../../db/rows.ts';
import type { TenantContext } from '../../db/tenant.ts';
import type { MissionCrewRow } from '../assignments/repository.ts';
import { listCrewMembers } from '../crew/repository.ts';
import { crewInputs, matchedMission } from '../matching/candidates.ts';
import { describeFailure, nameCrewMember, nameMission } from '../matching/reasons.ts';
import { toFailureResponse } from '../matching/result.ts';
import type { MissionRow, RequirementRow } from './repository.ts';

// The proposal check (DESIGN.md section 4): a proposed assignment is sound when its crew member
// passes every hard constraint and has no clash. It is worked out whenever a mission is read, from
// the data as it is then, so it is never stale.

/** What the check weighs: the missions, their requirements and crew, and the organisation's weights. */
interface ProposalsToCheck {
  missions: MissionRow[];
  requirements: RequirementRow[];
  missionCrew: MissionCrewRow[];
  weights: MatchWeights;
}

export type CheckedCrew = MissionCrewRow & { skill: string; problems: Problem[] };

const clash = (mission: MissionSummary): Problem => ({ kind: 'clash', mission });

/** The missions' crew, each with the problems of their proposal: none for crew past proposed. */
export async function checkProposals(context: TenantContext, { missions, requirements, missionCrew, weights }: ProposalsToCheck): Promise<CheckedCrew[]> {
  const proposedIds = new Set(missionCrew.filter(({ status }) => status === 'proposed').map(({ crewMemberId }) => crewMemberId));
  const crew = await crewInputs(context, (await listCrewMembers(context)).filter(({ id }) => proposedIds.has(id)));
  return missionCrew.map((assignment) => {
    const { skill, minLevel } = exactlyOne(requirements.filter(({ id }) => id === assignment.requirementId), 'requirement');
    if (assignment.status !== 'proposed') return { ...assignment, skill, problems: [] };
    const mission = exactlyOne(missions.filter(({ id }) => id === assignment.missionId), 'mission');
    const candidate = exactlyOne(crew.filter(({ id }) => id === assignment.crewMemberId), 'crew member');
    // Weighed as if this proposal were not there: it is the one being checked.
    const ref = formatRef('assignment', assignment.ref);
    const others = { ...candidate, assignments: candidate.assignments.filter((each) => each.ref !== ref) };
    const { failures, clashes } = assessCandidate({ crew: others, need: { skill, minLevel }, mission: matchedMission(mission) }, weights);
    const problems: Problem[] = [...clashes.map(clash), ...failures.map((failure) => ({ kind: 'hard_constraint' as const, failure: toFailureResponse(failure) }))];
    return { ...assignment, skill, problems };
  });
}

/** Each problem of the checked crew, as a sentence: what a refused submit lists. */
export const describeProblems = (crew: CheckedCrew[]) =>
  crew.flatMap(({ crewMember, skill, problems }) => {
    const summary = { ref: formatRef('crew_member', crewMember.ref), name: crewMember.name };
    return problems.map((problem) =>
      problem.kind === 'clash'
        ? `${nameCrewMember(summary)} is also proposed on ${nameMission(problem.mission)}`
        : describeFailure(summary, skill, problem.failure),
    );
  });
