import type { AssignmentStatus, CrewStatus, MatchWeights, MissionStatus, Period } from '@mission-control/contract';

// What the matcher is given (DESIGN.md section 6): everything it needs to decide, gathered by the
// API beforehand, so the matcher itself reads nothing.

/** A mission, as it is named in an explanation: a clash names the other mission, its status and owner. */
export interface MissionSummary {
  ref: string;
  name: string;
  status: MissionStatus;
  /** The owner's name. */
  owner: string;
}

/** One of a crew member's assignments, on any mission, this one included. */
export interface AssignmentInput {
  ref: string;
  mission: MissionSummary;
  period: Period;
  status: AssignmentStatus;
}

interface CrewSkillInput {
  skill: string;
  level: number;
  /** The last day the skill counts; null when it does not expire. */
  certifiedUntil: string | null;
}

export interface AvailabilityBlockInput {
  ref: string;
  period: Period;
}

export interface CrewInput {
  ref: string;
  name: string;
  status: CrewStatus;
  skills: CrewSkillInput[];
  availabilityBlocks: AvailabilityBlockInput[];
  assignments: AssignmentInput[];
}

export interface RequirementInput {
  skill: string;
  minLevel: number;
  headcount: number;
  /** Slots already taken by crew proposed, held, offered or accepted on this mission. Only the rest are solved. */
  filled: number;
}

export interface MatchInput {
  mission: { ref: string; period: Period };
  requirements: RequirementInput[];
  crew: CrewInput[];
  weights: MatchWeights;
}

/** One open slot: one unit of a requirement's headcount. */
export interface Slot {
  skill: string;
  minLevel: number;
  /** Which of the requirement's slots this is, from 1. */
  number: number;
  headcount: number;
}
