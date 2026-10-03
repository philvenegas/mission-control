import { DEFAULT_MATCH_WEIGHTS } from '@mission-control/contract';
import { expect, it } from 'vitest';
import { failuresOf } from './constraints.ts';
import type { CrewInput, MatchInput, Slot } from './input.ts';
import { match } from './match.ts';
import { scoreCandidate } from './scorers.ts';

/** A seeded generator (mulberry32), so a failing case can be run again. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const MISSION = { ref: 'MSN-8', status: 'draft' as const, period: { from: '2027-03-01', to: '2027-03-20' } };
const SKILLS = ['medic', 'pilot'];
const CERES = { ref: 'MSN-4', name: 'Ceres Resupply', status: 'draft' as const, owner: 'Sam Okafor' };

/** A small random mission and crew: a few skills and levels, some crew on leave, some proposed on another draft. */
function randomInput(next: () => number): MatchInput {
  const pick = (count: number) => Math.floor(next() * count);
  const requirements = SKILLS.filter(() => next() < 0.7).map((skill) => ({ skill, minLevel: 1 + pick(4), headcount: 1 + pick(2), filled: 0 }));
  const crew: CrewInput[] = Array.from({ length: pick(6) }, (_, index) => ({
    ref: `CRW-${index + 1}`,
    name: `Crew ${index + 1}`,
    status: next() < 0.9 ? 'active' : 'inactive',
    skills: SKILLS.filter(() => next() < 0.6).map((skill) => ({ skill, level: 1 + pick(5), certifiedUntil: null })),
    availabilityBlocks: next() < 0.2 ? [{ ref: 'AVL-1', period: { from: '2027-03-05', to: '2027-03-08' } }] : [],
    assignments: [
      ...(next() < 0.3 ? [{ ref: 'ASG-1', mission: CERES, period: { from: '2027-03-10', to: '2027-03-30' }, status: 'proposed' as const }] : []),
      // Earlier work, so scores differ in workload and rest too.
      ...(next() < 0.5
        ? [{ ref: 'ASG-2', mission: { ...CERES, ref: 'MSN-2', status: 'completed' as const }, period: { from: '2027-01-01', to: `2027-02-${String(1 + pick(28)).padStart(2, '0')}` }, status: 'accepted' as const }]
        : []),
    ],
  }));
  return { mission: MISSION, requirements, crew, weights: DEFAULT_MATCH_WEIGHTS };
}

/** How good a crew is, in the order DESIGN.md section 6.5 ranks them: slots filled, then clashes, then cost. */
interface Quality {
  filled: number;
  clashes: number;
  cost: number;
}
const better = (first: Quality, second: Quality) =>
  first.filled !== second.filled ? first.filled > second.filled : first.clashes !== second.clashes ? first.clashes < second.clashes : first.cost < second.cost;

const isClash = (crew: CrewInput) => crew.assignments.some((assignment) => assignment.status === 'proposed');

/** The best quality any crew could have, found by trying every way to fill or leave each slot. */
function bestByBruteForce(input: MatchInput): Quality {
  const slots: Slot[] = input.requirements.flatMap(({ skill, minLevel, headcount }) =>
    Array.from({ length: headcount }, (_, index) => ({ skill, minLevel, number: index + 1, headcount })),
  );
  const costOf = (crew: CrewInput, slot: Slot) => {
    const consideration = { crew, need: slot, mission: input.mission };
    return failuresOf(consideration).length > 0 ? null : Math.round((1 - scoreCandidate(consideration, input.weights).total) * 1_000_000);
  };
  let best: Quality = { filled: -1, clashes: 0, cost: 0 };
  const used = new Set<number>();
  const visit = (slotIndex: number, quality: Quality) => {
    const slot = slots[slotIndex];
    if (!slot) {
      if (better(quality, best)) best = quality;
      return;
    }
    visit(slotIndex + 1, quality);
    input.crew.forEach((crew, crewIndex) => {
      const cost = costOf(crew, slot);
      if (cost === null || used.has(crewIndex)) return;
      used.add(crewIndex);
      visit(slotIndex + 1, { filled: quality.filled + 1, clashes: quality.clashes + Number(isClash(crew)), cost: quality.cost + cost });
      used.delete(crewIndex);
    });
  };
  visit(0, { filled: 0, clashes: 0, cost: 0 });
  return best;
}

/** The quality of the crew the matcher chose. */
function qualityOf(input: MatchInput): Quality {
  const chosen = match(input).slots.flatMap(({ chosen }) => (chosen ? [chosen] : []));
  return {
    filled: chosen.length,
    clashes: chosen.filter(({ clashes }) => clashes.length > 0).length,
    cost: chosen.reduce((sum, { score }) => sum + Math.round((1 - score.total) * 1_000_000), 0),
  };
}

it('chooses as well as trying every crew: most slots filled, then fewest clashes, then best score, on 1000 random missions', () => {
  const next = random(20261003);
  for (let trial = 0; trial < 1000; trial++) {
    const input = randomInput(next);
    expect(qualityOf(input), `trial ${trial}: ${JSON.stringify(input)}`).toEqual(bestByBruteForce(input));
  }
});
