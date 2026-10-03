import { DEFAULT_MATCH_WEIGHTS } from '@mission-control/contract';
import { describe, expect, it } from 'vitest';
import type { AssignmentInput, CrewInput, MatchInput, RequirementInput } from './input.ts';
import { match } from './match.ts';

const EUROPA = { ref: 'MSN-8', period: { from: '2027-03-01', to: '2027-03-20' } };

let nextCrewNumber = 1;
/** A crew member with the given skills (name to level), free and rested unless changed. */
const crewMember = (name: string, skills: Record<string, number>, changes: Partial<CrewInput> = {}): CrewInput => ({
  ref: `CRW-${nextCrewNumber++}`,
  name,
  status: 'active',
  skills: Object.entries(skills).map(([skill, level]) => ({ skill, level, certifiedUntil: null })),
  availabilityBlocks: [],
  assignments: [],
  ...changes,
});

const requirement = (skill: string, minLevel: number, headcount = 1, filled = 0): RequirementInput => ({ skill, minLevel, headcount, filled });

const input = (requirements: RequirementInput[], crew: CrewInput[]): MatchInput => ({ mission: EUROPA, requirements, crew, weights: DEFAULT_MATCH_WEIGHTS });

/** Who each open slot went to, as `skill number: name`, or unfilled. */
const choices = (matchInput: MatchInput) =>
  match(matchInput).slots.map(({ slot, chosen }) => `${slot.skill} ${slot.number}: ${chosen ? chosen.crewMember.name : 'unfilled'}`);

const CERES = { ref: 'MSN-4', name: 'Ceres Resupply', status: 'draft' as const, owner: 'Sam Okafor' };
/** Proposed on another draft whose period overlaps this one: a clash, not a hold. */
const proposedOnCeres: AssignmentInput = { ref: 'ASG-40', mission: CERES, period: { from: '2027-03-10', to: '2027-03-30' }, status: 'proposed' };
const onLeave = { ref: 'AVL-3', period: { from: '2027-03-05', to: '2027-03-12' } };

describe('choosing a crew', () => {
  it('fills both slots where filling one at a time would not: Ben as pilot, Ada as medic (DESIGN.md section 6.3)', () => {
    const crew = [crewMember('Ada Reyes', { pilot: 5, medic: 4 }), crewMember('Ben Osei', { pilot: 4 }), crewMember('Cy Lindqvist', { engineer: 4 })];
    expect(choices(input([requirement('pilot', 3), requirement('medic', 4)], crew))).toEqual(['medic 1: Ada Reyes', 'pilot 1: Ben Osei']);
  });

  it('takes the best-scoring candidate when the choice changes nothing else', () => {
    const crew = [crewMember('Ben Osei', { pilot: 3 }), crewMember('Ada Reyes', { pilot: 5 })];
    expect(choices(input([requirement('pilot', 3)], crew))).toEqual(['pilot 1: Ada Reyes']);
  });

  it('avoids a clash when it can, at the cost of score, and makes one only to fill a slot, naming the other mission', () => {
    const ada = crewMember('Ada Reyes', { pilot: 5 }, { assignments: [proposedOnCeres] });
    const ben = crewMember('Ben Osei', { pilot: 3 });
    expect(choices(input([requirement('pilot', 3)], [ada, ben]))).toEqual(['pilot 1: Ben Osei']);
    const result = match(input([requirement('pilot', 3)], [ada, { ...ben, availabilityBlocks: [onLeave] }]));
    expect(result.slots[0]?.chosen).toMatchObject({ crewMember: { ref: ada.ref, name: 'Ada Reyes' }, clashes: [CERES] });
    expect(result.summary).toMatchObject({ clashes: 1 });
  });

  it('prefers more slots filled over fewer clashes', () => {
    const ada = crewMember('Ada Reyes', { pilot: 5, medic: 4 }, { assignments: [proposedOnCeres] });
    const ben = crewMember('Ben Osei', { pilot: 4 });
    expect(choices(input([requirement('pilot', 3), requirement('medic', 4)], [ada, ben]))).toEqual(['medic 1: Ada Reyes', 'pilot 1: Ben Osei']);
  });

  it('solves only the open slots, numbering them after those already filled', () => {
    const crew = [crewMember('Kira Novak', { engineer: 5 }), crewMember('Leo Adeyemi', { engineer: 4 })];
    const result = match(input([requirement('engineer', 4, 3, 1), requirement('pilot', 3, 1, 1)], crew));
    expect(result.slots.map(({ slot }) => `${slot.skill} ${slot.number} of ${slot.headcount}`)).toEqual(['engineer 2 of 3', 'engineer 3 of 3']);
    expect(result.summary).toEqual({ slots: 4, alreadyFilled: 2, open: 2, filled: 2, clashes: 0 });
  });
});

describe('explaining the choice', () => {
  it('gives each chosen crew member\'s score and its breakdown, and up to three alternates in score order', () => {
    const crew = ['Ada Reyes', 'Ben Osei', 'Cy Lindqvist', 'Dev Malhotra', 'Eli Navarro'].map((name, index) => crewMember(name, { pilot: 5 - index }));
    const [pilot] = match(input([requirement('pilot', 1)], crew)).slots;
    expect(pilot?.chosen?.crewMember.name).toBe('Ada Reyes');
    expect(pilot?.chosen?.score.components.map((component) => component.name)).toEqual(['proficiency', 'workload', 'rest']);
    expect(pilot?.alternates.map(({ crewMember: { name } }) => name)).toEqual(['Ben Osei', 'Cy Lindqvist', 'Dev Malhotra']);
  });

  it('marks an alternate who was chosen for another slot', () => {
    const crew = [crewMember('Ada Reyes', { pilot: 5, medic: 4 }), crewMember('Ben Osei', { pilot: 4 })];
    const pilot = match(input([requirement('pilot', 3), requirement('medic', 4)], crew)).slots.find(({ slot }) => slot.skill === 'pilot');
    expect(pilot?.alternates).toEqual([expect.objectContaining({ crewMember: expect.objectContaining({ name: 'Ada Reyes' }), chosenForAnotherSlot: true })]);
  });

  it('explains an unfilled slot: who was lost to each constraint, and the two nearest misses with what each lacks', () => {
    const rosa = crewMember('Rosa Imani', { geologist: 4 });
    const sven = crewMember('Sven Dahl', { geologist: 3 });
    const tala = crewMember('Tala Moreno', { geologist: 5 }, { availabilityBlocks: [onLeave] });
    const ben = crewMember('Ben Osei', { pilot: 4 });
    const result = match(input([requirement('geologist', 4, 2)], [rosa, sven, tala, ben]));
    expect(choices(input([requirement('geologist', 4, 2)], [rosa, sven, tala, ben]))).toEqual(['geologist 1: Rosa Imani', 'geologist 2: unfilled']);
    expect(result.slots[1]?.unfilled).toEqual({
      lostTo: [
        { reason: 'no_skill', count: 1 },
        { reason: 'below_level', count: 1 },
        { reason: 'availability', count: 1 },
        { reason: 'chosen_for_another_slot', count: 1 },
      ],
      nearestMisses: [
        { crewMember: { ref: tala.ref, name: 'Tala Moreno' }, exclusions: [{ constraint: 'availability', block: onLeave }] },
        { crewMember: { ref: sven.ref, name: 'Sven Dahl' }, exclusions: [{ constraint: 'skill', level: 3, minLevel: 4 }] },
      ],
    });
    expect(result.summary).toMatchObject({ open: 2, filled: 1 });
  });

  it('ranks nearest misses by how little each lacks, then by reference, and never one without the skill', () => {
    const inactiveStranger = crewMember('Uma Raj', { pilot: 4 }, { status: 'inactive' });
    const twoShort = crewMember('Vik Sorensen', { medic: 2 });
    const oneShortLater = crewMember('Wen Li', { medic: 3 });
    const oneShortEarlier = { ...crewMember('Xia Chen', { medic: 3 }), ref: 'CRW-1' };
    const [medic] = match(input([requirement('medic', 4)], [inactiveStranger, twoShort, oneShortLater, oneShortEarlier])).slots;
    expect(medic?.unfilled?.nearestMisses.map(({ crewMember: { name } }) => name)).toEqual(['Xia Chen', 'Wen Li']);
  });

  it('lists crew who hold a required skill but were left out, with why, and not those without it', () => {
    const omar = crewMember('Omar Vance', { medic: 5 }, { availabilityBlocks: [onLeave] });
    const noor = crewMember('Noor Haddad', { medic: 3 }, { skills: [{ skill: 'medic', level: 3, certifiedUntil: '2027-03-10' }] });
    const quin = crewMember('Quin Abara', { medic: 3 });
    const ben = crewMember('Ben Osei', { pilot: 4 });
    expect(match(input([requirement('medic', 3)], [omar, noor, quin, ben])).excluded).toEqual([
      { crewMember: { ref: omar.ref, name: 'Omar Vance' }, skill: 'medic', exclusions: [{ constraint: 'availability', block: onLeave }] },
      {
        crewMember: { ref: noor.ref, name: 'Noor Haddad' },
        skill: 'medic',
        exclusions: [{ constraint: 'certification', certifiedUntil: '2027-03-10', lastDay: '2027-03-19' }],
      },
    ]);
  });
});

describe('the same input', () => {
  it('always gives the same result, whatever order the crew and requirements arrive in', () => {
    const crew = [
      crewMember('Ada Reyes', { pilot: 4, medic: 4 }),
      crewMember('Ben Osei', { pilot: 4 }),
      crewMember('Cy Lindqvist', { pilot: 4, medic: 4 }),
      crewMember('Mina Farouk', { medic: 4 }),
    ];
    const requirements = [requirement('pilot', 3, 2), requirement('medic', 3)];
    const first = match(input(requirements, crew));
    expect(match(input(requirements, crew))).toEqual(first);
    expect(match(input([...requirements].reverse(), [...crew].reverse()))).toEqual(first);
  });

  it('refuses crew without a crew member\'s reference, which it could not order', () => {
    expect(() => match(input([requirement('pilot', 3)], [{ ...crewMember('Nobody', { pilot: 4 }), ref: 'pilot-1' }]))).toThrow(
      '"pilot-1" is not a crew member\'s reference',
    );
  });

  it('orders crew by reference number, not as text, so CRW-10 comes after CRW-9', () => {
    const nine = { ...crewMember('Nine', { pilot: 4 }), ref: 'CRW-9' };
    const ten = { ...crewMember('Ten', { pilot: 4 }), ref: 'CRW-10' };
    // Equal scores: the earlier reference wins the tie.
    expect(choices(input([requirement('pilot', 3)], [ten, nine]))).toEqual(['pilot 1: Nine']);
  });
});
