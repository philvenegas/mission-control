import { type AssignmentStatus, LIVE_ASSIGNMENT_STATUSES, type Period } from '@mission-control/contract';
import { lastDay, overlaps } from './dates.ts';
import type { AssignmentInput, AvailabilityBlockInput, CrewInput, Slot } from './input.ts';

/** The mission being matched, as the constraints need it. */
export interface MatchedMission {
  ref: string;
  period: Period;
}

/** Why a crew member is not a candidate for a slot: the constraint that failed, with what failed it. */
export type Exclusion =
  | { constraint: 'active' }
  /** `level` is null when the crew member does not have the skill at all. */
  | { constraint: 'skill'; level: number | null; minLevel: number }
  | { constraint: 'certification'; certifiedUntil: string; lastDay: string }
  | { constraint: 'availability'; block: AvailabilityBlockInput }
  | { constraint: 'free'; assignment: AssignmentInput }
  | { constraint: 'not_declined'; assignment: AssignmentInput }
  | { constraint: 'not_on_mission'; assignment: AssignmentInput };

type ConstraintName = Exclusion['constraint'];

/** A hard constraint: a crew member is a candidate for a slot only if every one passes. */
export interface HardConstraint {
  name: ConstraintName;
  /** Why the crew member fails it, or null when they pass. */
  check: (crew: CrewInput, slot: Slot, mission: MatchedMission) => Exclusion | null;
}

const isLive = (status: AssignmentStatus) => LIVE_ASSIGNMENT_STATUSES.some((live) => live === status);

/** The statuses that put a crew member in one of this mission's slots. */
const PLACED: readonly AssignmentStatus[] = ['proposed', ...LIVE_ASSIGNMENT_STATUSES];

const skillOf = (crew: CrewInput, slot: Slot) => crew.skills.find((held) => held.skill === slot.skill);

const onThisMission = (crew: CrewInput, mission: MatchedMission) => crew.assignments.filter((assignment) => assignment.mission.ref === mission.ref);

/** DESIGN.md section 6.2, in order. Adding a constraint means adding one entry here. */
export const HARD_CONSTRAINTS: readonly HardConstraint[] = [
  {
    name: 'active',
    check: (crew) => (crew.status === 'active' ? null : { constraint: 'active' }),
  },
  {
    name: 'skill',
    check: (crew, slot) => {
      const level = skillOf(crew, slot)?.level ?? null;
      return level !== null && level >= slot.minLevel ? null : { constraint: 'skill', level, minLevel: slot.minLevel };
    },
  },
  {
    name: 'certification',
    check: (crew, slot, mission) => {
      const certifiedUntil = skillOf(crew, slot)?.certifiedUntil ?? null;
      const missionLastDay = lastDay(mission.period);
      return certifiedUntil === null || certifiedUntil >= missionLastDay
        ? null
        : { constraint: 'certification', certifiedUntil, lastDay: missionLastDay };
    },
  },
  {
    name: 'availability',
    check: (crew, _, mission) => {
      const block = crew.availabilityBlocks.find((candidate) => overlaps(candidate.period, mission.period));
      return block ? { constraint: 'availability', block } : null;
    },
  },
  {
    // A proposal on another draft is not a hold: it is a clash, which the solver weighs instead.
    name: 'free',
    check: (crew, _, mission) => {
      const assignment = crew.assignments.find(
        (candidate) => candidate.mission.ref !== mission.ref && isLive(candidate.status) && overlaps(candidate.period, mission.period),
      );
      return assignment ? { constraint: 'free', assignment } : null;
    },
  },
  {
    name: 'not_declined',
    check: (crew, _, mission) => {
      const assignment = onThisMission(crew, mission).find((candidate) => candidate.status === 'declined');
      return assignment ? { constraint: 'not_declined', assignment } : null;
    },
  },
  {
    // Each crew member fills one slot at most (DESIGN.md section 6.1), so one already in a slot of
    // this mission is not a candidate for another.
    name: 'not_on_mission',
    check: (crew, _, mission) => {
      const assignment = onThisMission(crew, mission).find((candidate) => PLACED.includes(candidate.status));
      return assignment ? { constraint: 'not_on_mission', assignment } : null;
    },
  },
];

/** Every constraint a crew member fails for a slot, in the order of the list. None means they are a candidate. */
export function exclusionsOf(crew: CrewInput, slot: Slot, mission: MatchedMission): Exclusion[] {
  return HARD_CONSTRAINTS.flatMap((constraint) => constraint.check(crew, slot, mission) ?? []);
}
