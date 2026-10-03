import type { MatchWeights } from '@mission-control/contract';
import { type ConstraintFailure, failuresOf } from './constraints.ts';
import { assignmentsElsewhere, type Consideration, type MissionSummary } from './input.ts';
import { type Score, scoreCandidate } from './scorers.ts';

/** What one crew member would be in one slot: why they cannot fill it, whom they would clash with, and their score. */
export interface Assessment {
  /** Every hard constraint they fail, in the list's order. None means they are a candidate. */
  failures: ConstraintFailure[];
  /**
   * The other drafts over this period that propose them. Only drafts clash: on a mission past
   * draft, a proposal elsewhere is the other mission's problem.
   */
  clashes: MissionSummary[];
  /** Their score, when they are a candidate. */
  score: Score | null;
}

/**
 * One crew member weighed for one slot. The matcher weighs every pair this way, and the API weighs
 * a crew member it is about to place, so a hand assignment and an applied run answer as the matcher would.
 */
export function assessCandidate(consideration: Consideration, weights: MatchWeights): Assessment {
  const failures = failuresOf(consideration);
  const { crew, mission } = consideration;
  return {
    failures,
    clashes: mission.status === 'draft' ? assignmentsElsewhere(crew, mission, ['proposed']).map((assignment) => assignment.mission) : [],
    score: failures.length === 0 ? scoreCandidate(consideration, weights) : null,
  };
}
