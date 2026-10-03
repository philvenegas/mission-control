import { LIVE_ASSIGNMENT_STATUSES, PLACED_ASSIGNMENT_STATUSES, periodsOverlap } from '@mission-control/contract';
import { lastDay } from './dates.ts';
import { type AssignmentInput, type AvailabilityBlockInput, assignmentsElsewhere, type Consideration, skillRecord } from './input.ts';

/** Why a crew member is not a candidate for a slot: the hard constraint that failed, with what failed it. */
export type ConstraintFailure =
  | { constraint: 'active' }
  /** `level` is null when the crew member does not hold the skill at all. */
  | { constraint: 'skill'; level: number | null; minLevel: number }
  | { constraint: 'certification'; certifiedUntil: string; lastDay: string }
  | { constraint: 'availability'; block: AvailabilityBlockInput }
  | { constraint: 'free'; assignment: AssignmentInput }
  | { constraint: 'not_declined'; assignment: AssignmentInput }
  | { constraint: 'not_on_mission'; assignment: AssignmentInput };

/** A hard constraint: a crew member is a candidate for a slot only if every one passes. */
interface HardConstraint {
  name: ConstraintFailure['constraint'];
  /** Why the crew member fails it, or null when they pass. */
  check: (consideration: Consideration) => ConstraintFailure | null;
}

const onThisMission = ({ crew, mission }: Consideration) => crew.assignments.filter((assignment) => assignment.mission.ref === mission.ref);

/** DESIGN.md section 6.2, in order. Adding a constraint means adding one entry here. */
export const HARD_CONSTRAINTS: readonly HardConstraint[] = [
  {
    name: 'active',
    check: ({ crew }) => (crew.status === 'active' ? null : { constraint: 'active' }),
  },
  {
    name: 'skill',
    check: ({ crew, need }) => {
      const level = skillRecord(crew, need.skill)?.level ?? null;
      return level !== null && level >= need.minLevel ? null : { constraint: 'skill', level, minLevel: need.minLevel };
    },
  },
  {
    name: 'certification',
    check: ({ crew, need, mission }) => {
      const certifiedUntil = skillRecord(crew, need.skill)?.certifiedUntil ?? null;
      const missionLastDay = lastDay(mission.period);
      return certifiedUntil === null || certifiedUntil >= missionLastDay
        ? null
        : { constraint: 'certification', certifiedUntil, lastDay: missionLastDay };
    },
  },
  {
    name: 'availability',
    check: ({ crew, mission }) => {
      const block = crew.availabilityBlocks.find((each) => periodsOverlap(each.period, mission.period));
      return block ? { constraint: 'availability', block } : null;
    },
  },
  {
    // A proposal on another draft is not a hold: it is a clash, which the solver weighs instead.
    name: 'free',
    check: ({ crew, mission }) => {
      const [assignment] = assignmentsElsewhere(crew, mission, LIVE_ASSIGNMENT_STATUSES);
      return assignment ? { constraint: 'free', assignment } : null;
    },
  },
  {
    name: 'not_declined',
    check: (consideration) => {
      const assignment = onThisMission(consideration).find((each) => each.status === 'declined');
      return assignment ? { constraint: 'not_declined', assignment } : null;
    },
  },
  {
    // Each crew member fills one slot at most (DESIGN.md section 6.1), so one already in a slot of
    // this mission is not a candidate for another.
    name: 'not_on_mission',
    check: (consideration) => {
      const assignment = onThisMission(consideration).find((each) => PLACED_ASSIGNMENT_STATUSES.some((status) => status === each.status));
      return assignment ? { constraint: 'not_on_mission', assignment } : null;
    },
  },
];

/** Every constraint a crew member fails for a slot, in the order of the list. None means they are a candidate. */
export function failuresOf(consideration: Consideration): ConstraintFailure[] {
  return HARD_CONSTRAINTS.flatMap((constraint) => constraint.check(consideration) ?? []);
}
