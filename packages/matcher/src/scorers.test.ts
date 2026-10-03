import { DEFAULT_MATCH_WEIGHTS, type Period } from '@mission-control/contract';
import { describe, expect, it } from 'vitest';
import { addDays } from './dates.ts';
import type { CrewInput, Slot } from './input.ts';
import { scoreCandidate } from './scorers.ts';

const START = '2027-03-01';
const MISSION = { ref: 'MSN-8', status: 'draft' as const, period: { from: START, to: '2027-03-20' } };

/** A period of `days` days that ends `daysBeforeStart` days before the mission starts. */
const before = (days: number, daysBeforeStart: number): Period => ({
  from: addDays(START, -daysBeforeStart - days),
  to: addDays(START, -daysBeforeStart),
});

/** A crew member holding one skill, with the given past (or later) accepted assignments. */
const crew = (skill: string, level: number, history: Period[] = []): CrewInput => ({
  ref: 'CRW-1',
  name: 'Crew',
  status: 'active',
  skills: [{ skill, level, certifiedUntil: null }],
  availabilityBlocks: [],
  assignments: history.map((period, index) => ({
    ref: `ASG-${index + 1}`,
    mission: { ref: `MSN-${100 + index}`, name: 'Earlier mission', status: 'completed', owner: 'Sam Okafor' },
    period,
    status: 'accepted',
  })),
});

const slot = (skill: string, minLevel: number): Slot => ({ skill, minLevel, number: 1, headcount: 1 });

/** One component of a candidate's score for a slot: its value, and what it was worked out from. */
const measured = (name: string, candidate: CrewInput, required: Slot) => {
  const component = scoreCandidate({ crew: candidate, need: required, mission: MISSION }, DEFAULT_MATCH_WEIGHTS).components.find((each) => each.name === name);
  if (!component) throw new Error(`No component named ${name}`);
  return component;
};
const componentOf = (name: string, candidate: CrewInput, required: Slot) => measured(name, candidate, required).value;

/** The score as a person reads it, out of 100. */
const points = (candidate: CrewInput, required: Slot) =>
  Math.round(scoreCandidate({ crew: candidate, need: required, mission: MISSION }, DEFAULT_MATCH_WEIGHTS).total * 100);

describe('the scorers of DESIGN.md section 6.4', () => {
  it('scores proficiency as 60% for meeting the bar and 10 points for each level above it', () => {
    expect(componentOf('proficiency', crew('pilot', 3), slot('pilot', 3))).toBeCloseTo(0.6);
    expect(componentOf('proficiency', crew('pilot', 5), slot('pilot', 3))).toBeCloseTo(0.8);
    expect(componentOf('proficiency', crew('pilot', 5), slot('pilot', 1))).toBeCloseTo(1);
  });

  it('scores workload balance by the days assigned in the 90 days either side of the start, out of 180', () => {
    expect(componentOf('workload', crew('pilot', 3), slot('pilot', 3))).toBe(1);
    expect(componentOf('workload', crew('pilot', 3, [before(45, 10)]), slot('pilot', 3))).toBeCloseTo(1 - 45 / 180);
    // Only the days inside the window count: 30 of these 60 fall more than 90 days before the start.
    expect(componentOf('workload', crew('pilot', 3, [before(60, 60)]), slot('pilot', 3))).toBeCloseTo(1 - 30 / 180);
    // Days after the start count too.
    const later = { from: addDays(START, 40), to: addDays(START, 50) };
    expect(componentOf('workload', crew('pilot', 3, [later]), slot('pilot', 3))).toBeCloseTo(1 - 10 / 180);
  });

  it('counts only held, offered and accepted assignments as days assigned', () => {
    const candidate = crew('pilot', 3, [before(45, 10)]);
    for (const status of ['proposed', 'declined', 'released'] as const) {
      const assignments = candidate.assignments.map((assignment) => ({ ...assignment, status }));
      expect(componentOf('workload', { ...candidate, assignments }, slot('pilot', 3))).toBe(1);
      expect(componentOf('rest', { ...candidate, assignments }, slot('pilot', 3))).toBe(1);
    }
  });

  it('scores rest by the days since the previous assignment ended, capped at 30, and full for one who has never flown', () => {
    expect(componentOf('rest', crew('pilot', 3), slot('pilot', 3))).toBe(1);
    expect(componentOf('rest', crew('pilot', 3, [before(10, 0)]), slot('pilot', 3))).toBe(0);
    expect(componentOf('rest', crew('pilot', 3, [before(10, 12)]), slot('pilot', 3))).toBeCloseTo(12 / 30);
    expect(componentOf('rest', crew('pilot', 3, [before(10, 45)]), slot('pilot', 3))).toBe(1);
    // The previous assignment is the latest that ended before the start, not the first.
    expect(componentOf('rest', crew('pilot', 3, [before(10, 12), before(5, 50)]), slot('pilot', 3))).toBeCloseTo(12 / 30);
    expect(componentOf('rest', crew('pilot', 3, [before(5, 50), before(10, 12)]), slot('pilot', 3))).toBeCloseTo(12 / 30);
  });

  it('weighs the components by the weights given, and gives each one\'s points', () => {
    const scored = scoreCandidate({ crew: crew('pilot', 5, [before(45, 10)]), need: slot('pilot', 3), mission: MISSION }, { proficiency: 0.5, workload: 0.5, rest: 0 });
    expect(scored.total).toBeCloseTo(0.5 * 0.8 + 0.5 * 0.75);
    expect(scored.components.map(({ name, weight }) => [name, weight])).toEqual([
      ['proficiency', 0.5],
      ['workload', 0.5],
      ['rest', 0],
    ]);
    expect(scored.components.find((component) => component.name === 'proficiency')).toMatchObject({ value: 0.8, points: 0.4 });
  });
});

describe('what each component was worked out from, so a person can be told why', () => {
  it('gives the level held for proficiency', () => {
    expect(measured('proficiency', crew('pilot', 5), slot('pilot', 3))).toMatchObject({ name: 'proficiency', level: 5 });
  });

  it('gives the days assigned for workload balance, out of the 180 days around the start', () => {
    expect(measured('workload', crew('pilot', 3, [before(45, 10)]), slot('pilot', 3))).toMatchObject({ name: 'workload', daysAssigned: 45, windowDays: 180 });
    expect(measured('workload', crew('pilot', 3), slot('pilot', 3))).toMatchObject({ daysAssigned: 0, windowDays: 180 });
  });

  it('gives the days rested, uncapped, and none for a crew member who has never flown', () => {
    expect(measured('rest', crew('pilot', 3, [before(10, 12)]), slot('pilot', 3))).toMatchObject({ name: 'rest', daysRested: 12 });
    expect(measured('rest', crew('pilot', 3, [before(10, 45)]), slot('pilot', 3))).toMatchObject({ daysRested: 45, value: 1 });
    expect(measured('rest', crew('pilot', 3), slot('pilot', 3))).toMatchObject({ daysRested: null, value: 1 });
  });
});

describe('the consequences of the scoring that DESIGN.md section 6.4 accepts', () => {
  it('lets fairness outrank skill: a tired expert scores 57, a rested crew member who just meets the bar 82', () => {
    const tiredExpert = crew('geologist', 5, [before(80, 3)]);
    const rested = crew('geologist', 3);
    expect(points(tiredExpert, slot('geologist', 3))).toBe(57);
    expect(points(rested, slot('geologist', 3))).toBe(82);
  });

  it('sends an expert to a routine slot when all else is equal, but not after a moderately heavier workload', () => {
    const expert = (history: Period[]) => crew('comms', 5, history);
    const meetsTheBar = crew('comms', 2, [before(30, 20)]);
    expect(points(expert([before(30, 20)]), slot('comms', 2))).toBeGreaterThan(points(meetsTheBar, slot('comms', 2)));
    // Eighty more days: 60 before the start and 50 after it, against the other's 30.
    const busier = expert([before(60, 20), { from: addDays(START, 40), to: addDays(START, 90) }]);
    expect(points(busier, slot('comms', 2))).toBeLessThan(points(meetsTheBar, slot('comms', 2)));
  });

  it('ranks a new hire with no history above a slightly stronger crew member with a normal schedule', () => {
    const newHire = crew('navigator', 4);
    const veteran = crew('navigator', 5, [before(30, 20)]);
    expect(points(newHire, slot('navigator', 3))).toBeGreaterThan(points(veteran, slot('navigator', 3)));
  });
});
