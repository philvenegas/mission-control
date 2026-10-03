import { LIVE_ASSIGNMENT_STATUSES, type MatchWeights } from '@mission-control/contract';
import type { MatchedMission } from './constraints.ts';
import { addDays, daysBetween, sharedDays } from './dates.ts';
import type { CrewInput, Slot } from './input.ts';

/** What a scorer looks at: a candidate who has passed every hard constraint, for one slot. */
interface ScoringContext {
  crew: CrewInput;
  slot: Slot;
  mission: MatchedMission;
}

/** One component of a score: a pure function giving 0 to 1, weighted by the organisation's setting of the same name. */
export interface Scorer {
  name: keyof MatchWeights;
  score: (context: ScoringContext) => number;
}

/** How far either side of the mission's start workload is counted. */
const WORKLOAD_WINDOW_DAYS = 90;
/** Days of rest after which more rest earns nothing. */
const FULL_REST_DAYS = 30;

/** The crew member's assignments that hold them: held, offered or accepted, on any mission. */
const liveAssignments = (crew: CrewInput) =>
  crew.assignments.filter((assignment) => LIVE_ASSIGNMENT_STATUSES.some((status) => status === assignment.status));

/** DESIGN.md section 6.4. Adding a component means adding one entry here, and a weight. */
export const SCORERS: readonly Scorer[] = [
  {
    // Meeting the bar earns 60%; each level above it adds 10 points.
    name: 'proficiency',
    score: ({ crew, slot }) => {
      // A candidate holds the skill at the bar or above; nobody scores below the bar.
      const level = Math.max(slot.minLevel, ...crew.skills.filter((held) => held.skill === slot.skill).map((held) => held.level));
      return 0.6 + 0.1 * (level - slot.minLevel);
    },
  },
  {
    // One minus the share of the 180 days around the start that the crew member is assigned.
    name: 'workload',
    score: ({ crew, mission }) => {
      const window = { from: addDays(mission.period.from, -WORKLOAD_WINDOW_DAYS), to: addDays(mission.period.from, WORKLOAD_WINDOW_DAYS) };
      const assigned = liveAssignments(crew).reduce((days, assignment) => days + sharedDays(assignment.period, window), 0);
      return 1 - Math.min(assigned, 2 * WORKLOAD_WINDOW_DAYS) / (2 * WORKLOAD_WINDOW_DAYS);
    },
  },
  {
    // Days since the latest assignment that ended before the start, out of 30. Never flown is fully rested.
    name: 'rest',
    score: ({ crew, mission }) => {
      const ended = liveAssignments(crew)
        .map((assignment) => assignment.period.to)
        .filter((end) => end <= mission.period.from);
      if (ended.length === 0) return 1;
      const latestEnd = ended.reduce((latest, end) => (end > latest ? end : latest));
      return Math.min(daysBetween(latestEnd, mission.period.from), FULL_REST_DAYS) / FULL_REST_DAYS;
    },
  },
];

/** One component of a candidate's score: its value from 0 to 1, its share of the whole, and the points it earned. */
export interface ScoreComponent {
  name: keyof MatchWeights;
  value: number;
  weight: number;
  points: number;
}

export interface Score {
  /** From 0 to 1: the sum of the components' points. */
  total: number;
  components: ScoreComponent[];
}

/**
 * A candidate's score for a slot: each component's value times its weight. The weights are taken as
 * shares of their sum, so a score is always between 0 and 1 whatever scale the organisation set.
 */
export function scoreCandidate(crew: CrewInput, slot: Slot, mission: MatchedMission, weights: MatchWeights): Score {
  const weightSum = SCORERS.reduce((sum, scorer) => sum + weights[scorer.name], 0);
  const components = SCORERS.map((scorer) => {
    const value = scorer.score({ crew, slot, mission });
    const weight = weights[scorer.name] / weightSum;
    return { name: scorer.name, value, weight, points: value * weight };
  });
  return { total: components.reduce((sum, component) => sum + component.points, 0), components };
}
