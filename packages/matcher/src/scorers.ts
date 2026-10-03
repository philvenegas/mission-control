import { isLiveStatus, type MatchWeights } from '@mission-control/contract';
import { addDays, daysBetween, sharedDays } from './dates.ts';
import type { Consideration, CrewInput } from './input.ts';

/** How far either side of the mission's start workload is counted. */
const WORKLOAD_WINDOW_DAYS = 90;
/** Days of rest after which more rest earns nothing. */
const FULL_REST_DAYS = 30;

/** The crew member's assignments that hold them: held, offered or accepted, on any mission. */
const liveAssignments = (crew: CrewInput) => crew.assignments.filter((assignment) => isLiveStatus(assignment.status));

/**
 * What a component was worked out from, so a person can be told why a candidate scored as they did:
 * the level held, the days assigned in the window around the start, and the days rested since the
 * previous assignment (none for a crew member who has never flown).
 */
type ScoreBasis =
  | { name: 'proficiency'; level: number }
  | { name: 'workload'; daysAssigned: number; windowDays: number }
  | { name: 'rest'; daysRested: number | null };

/** One component of a score: a pure function giving 0 to 1, weighted by the organisation's setting of the same name. */
type Scorer = (consideration: Consideration) => { value: number; basis: ScoreBasis };

/**
 * DESIGN.md section 6.4. Adding a component means adding one entry here, a basis and a weight; the
 * contract's `scoreComponentSchema`, the API's `result.ts` and the CLI's `describeComponent` then put its basis into words.
 */
const SCORERS: readonly Scorer[] = [
  // Meeting the bar earns 60%; each level above it adds 10 points. A candidate holds the skill at
  // the bar or above, so nobody is scored below it.
  ({ crew, need }) => {
    const level = Math.max(need.minLevel, ...crew.skills.filter((held) => held.skill === need.skill).map((held) => held.level));
    return { value: 0.6 + 0.1 * (level - need.minLevel), basis: { name: 'proficiency', level } };
  },
  // One minus the share of the 180 days around the start that the crew member is assigned.
  ({ crew, mission }) => {
    const windowDays = 2 * WORKLOAD_WINDOW_DAYS;
    const window = { from: addDays(mission.period.from, -WORKLOAD_WINDOW_DAYS), to: addDays(mission.period.from, WORKLOAD_WINDOW_DAYS) };
    const assigned = liveAssignments(crew).reduce((days, assignment) => days + sharedDays(assignment.period, window), 0);
    const daysAssigned = Math.min(assigned, windowDays);
    return { value: 1 - daysAssigned / windowDays, basis: { name: 'workload', daysAssigned, windowDays } };
  },
  // Days since the latest assignment that ended before the start, out of 30. Never flown is fully rested.
  ({ crew, mission }) => {
    const ended = liveAssignments(crew)
      .map((assignment) => assignment.period.to)
      .filter((end) => end <= mission.period.from);
    if (ended.length === 0) return { value: 1, basis: { name: 'rest', daysRested: null } };
    const latestEnd = ended.reduce((latest, end) => (end > latest ? end : latest));
    const daysRested = daysBetween(latestEnd, mission.period.from);
    return { value: Math.min(daysRested, FULL_REST_DAYS) / FULL_REST_DAYS, basis: { name: 'rest', daysRested } };
  },
];

/** One component of a candidate's score: its value from 0 to 1, its share of the whole, and the points it earned. */
export type ScoreComponent = ScoreBasis & { value: number; weight: number; points: number };

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
  const weightSum = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const components = SCORERS.map((scorer): ScoreComponent => {
    const { value, basis } = scorer(consideration);
    const weight = weights[basis.name] / weightSum;
    return { ...basis, value, weight, points: value * weight };
  });
  return { total: components.reduce((sum, component) => sum + component.points, 0), components };
}
