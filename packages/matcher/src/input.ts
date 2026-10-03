import { type AssignmentStatus, type CrewStatus, type MatchWeights, type MissionStatus, type Period, periodsOverlap } from '@mission-control/contract';

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

/** The mission being matched. Its status decides whether a proposal elsewhere is a clash: only between drafts. */
export interface MatchedMission {
  ref: string;
  status: MissionStatus;
  period: Period;
}

export interface MatchInput {
  mission: MatchedMission;
  requirements: RequirementInput[];
  crew: CrewInput[];
  weights: MatchWeights;
}

/** What a slot asks of whoever fills it. */
interface SkillNeed {
  skill: string;
  minLevel: number;
}

/** One open slot: one unit of a requirement's headcount. */
export interface Slot extends SkillNeed {
  /** Which of the requirement's slots this is, from 1. */
  number: number;
  headcount: number;
}

/** One crew member considered for one slot of the mission: what a hard constraint checks and a scorer scores. */
export interface Consideration {
  crew: CrewInput;
  need: SkillNeed;
  mission: MatchedMission;
}

/** The crew member's record of a skill, if they hold it. */
export const skillRecord = (crew: CrewInput, skill: string) => crew.skills.find((held) => held.skill === skill);

/** The crew member's assignments on missions other than this one, over its period, with one of the statuses. */
export const assignmentsElsewhere = (crew: CrewInput, mission: MatchedMission, statuses: readonly AssignmentStatus[]) =>
  crew.assignments.filter(
    (assignment) => assignment.mission.ref !== mission.ref && statuses.includes(assignment.status) && periodsOverlap(assignment.period, mission.period),
  );
