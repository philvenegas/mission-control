import { DEFAULT_MATCH_WEIGHTS } from '@mission-control/contract';
import { describe, expect, it } from 'vitest';
import { assessCandidate } from './assess.ts';
import type { CrewInput, MatchedMission } from './input.ts';
import { match } from './match.ts';

const EUROPA: MatchedMission = { ref: 'MSN-8', status: 'draft', period: { from: '2027-03-01', to: '2027-03-20' } };
const CERES = { ref: 'MSN-4', name: 'Ceres Resupply', status: 'draft' as const, owner: 'Sam Okafor' };
const PILOT = { skill: 'pilot', minLevel: 3 };

const ada: CrewInput = {
  ref: 'CRW-1',
  name: 'Ada Reyes',
  status: 'active',
  skills: [{ skill: 'pilot', level: 5, certifiedUntil: null }],
  availabilityBlocks: [],
  assignments: [],
};
const proposedOnCeres = { ref: 'ASG-40', mission: CERES, period: { from: '2027-03-10', to: '2027-03-30' }, status: 'proposed' as const };

describe('assessing one crew member for one slot', () => {
  it('scores a candidate exactly as the matcher does, with no failures and no clash', () => {
    const assessment = assessCandidate({ crew: ada, need: PILOT, mission: EUROPA }, DEFAULT_MATCH_WEIGHTS);
    const chosen = match({ mission: EUROPA, requirements: [{ ...PILOT, headcount: 1, filled: 0 }], crew: [ada], weights: DEFAULT_MATCH_WEIGHTS }).slots[0]?.chosen;
    expect(assessment).toEqual({ failures: [], clashes: [], score: chosen?.score });
    // 0.45 × 0.8 for two levels above the bar, plus full workload and rest.
    expect(assessment.score?.total).toBeCloseTo(0.91);
  });

  it('gives every hard constraint the crew member fails, and no score', () => {
    const away = { ...ada, status: 'inactive' as const, availabilityBlocks: [{ ref: 'AVL-3', period: { from: '2027-03-05', to: '2027-03-12' } }] };
    expect(assessCandidate({ crew: away, need: { skill: 'pilot', minLevel: 3 }, mission: EUROPA }, DEFAULT_MATCH_WEIGHTS)).toEqual({
      failures: [{ constraint: 'active' }, { constraint: 'availability', block: away.availabilityBlocks[0] }],
      clashes: [],
      score: null,
    });
  });

  it('names the other draft that proposes them over the same period, on a draft only', () => {
    const planned = { ...ada, assignments: [proposedOnCeres] };
    expect(assessCandidate({ crew: planned, need: PILOT, mission: EUROPA }, DEFAULT_MATCH_WEIGHTS).clashes).toEqual([CERES]);
    expect(assessCandidate({ crew: planned, need: PILOT, mission: { ...EUROPA, status: 'approved' } }, DEFAULT_MATCH_WEIGHTS).clashes).toEqual([]);
  });
});
