import { isLiveStatus, type MatchWeights } from '@mission-control/contract';
import { addDays, daysBetween, sharedDays } from './dates.ts';
import type { Consideration, CrewInput } from './input.ts';

/** One component of a score: a pure function giving 0 to 1, weighted by the organisation's setting of the same name. */
interface Scorer {
  name: keyof MatchWeights;
  score: (consideration: Consideration) => number;
}

/** How far either side of the mission's start workload is counted. */
const WORKLOAD_WINDOW_DAYS = 90;
/** Days of rest after which more rest earns nothing. */
const FULL_REST_DAYS = 30;

/** The crew member's assignments that hold them: held, offered or accepted, on any mission. */
const liveAssignments = (crew: CrewInput) => crew.assignments.filter((assignment) => isLiveStatus(assignment.status));

/** DESIGN.md section 6.4. Adding a component means adding one entry here, and a weight. */
export const SCORERS: readonly Scorer[] = [
  {
    // Meeting the bar earns 60%; each level above it adds 10 points. A candidate holds the skill at
    // the bar or above, so nobody is scored below it.
    name: 'proficiency',
    score: ({ crew, need }) => {
      const level = Math.max(need.minLevel, ...crew.skills.filter((held) => held.skill === need.skill).map((held) => held.level));
      return 0.6 + 0.1 * (level - need.minLevel);
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
export function scoreCandidate(consideration: Consideration, weights: MatchWeights): Score {
  const weightSum = SCORERS.reduce((sum, scorer) => sum + weights[scorer.name], 0);
  const components = SCORERS.map((scorer) => {
    const value = scorer.score(consideration);
    const weight = weights[scorer.name] / weightSum;
    return { name: scorer.name, value, weight, points: value * weight };
  });
  return { total: components.reduce((sum, component) => sum + component.points, 0), components };
}
