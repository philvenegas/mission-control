import type { ConstraintFailureResponse, CrewMemberSummary, MissionStatus } from '@mission-control/contract';

// Why a crew member cannot fill a slot, in words, for the refusals the API gives: a hand assignment
// and an applied match run give the same reasons as the matcher, because they come from the same check.

/** How a refusal names a crew member: "Ada Reyes CRW-1". */
export const nameCrewMember = ({ ref, name }: CrewMemberSummary) => `${name} ${ref}`;

/** How a refusal names another mission: "MSN-4 Ceres Resupply (draft, Sam Okafor)". */
export const nameMission = ({ ref, name, status, owner }: { ref: string; name: string; status: MissionStatus; owner: string }) =>
  `${ref} ${name} (${status}, ${owner})`;

/** One failed hard constraint, as a sentence about the crew member. */
export function describeFailure(crewMember: CrewMemberSummary, skill: string, failure: ConstraintFailureResponse): string {
  const who = nameCrewMember(crewMember);
  switch (failure.constraint) {
    case 'active':
      return `${who} is inactive`;
    case 'skill':
      return failure.level === null
        ? `${who} does not have ${skill}`
        : `${who} is ${skill} level ${failure.level}, below the ${failure.min_level} needed`;
    case 'certification':
      return `${who}'s ${skill} certification expires on ${failure.certified_until}, before the mission's last day, ${failure.last_day}`;
    case 'availability':
      return `${who} has availability block ${failure.block.ref}, ${failure.block.from} to ${failure.block.to}`;
    case 'free':
      return `${who} is ${failure.assignment.status} on ${nameMission(failure.assignment.mission)} over the same period`;
    case 'not_declined':
      return `${who} declined ${failure.assignment.mission.ref}`;
    case 'not_on_mission':
      return `${who} is already in one of ${failure.assignment.mission.ref}'s slots (${failure.assignment.ref})`;
  }
}
