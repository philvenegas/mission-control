import { ASSIGNMENT_STATUSES, isLiveStatus, LIVE_ASSIGNMENT_STATUSES } from '@mission-control/contract';
import { describe, expect, it } from 'vitest';
import { failuresOf, HARD_CONSTRAINTS } from './constraints.ts';
import type { AssignmentInput, CrewInput, Slot } from './input.ts';

const EUROPA = { ref: 'MSN-8', status: 'draft' as const, period: { from: '2027-03-01', to: '2027-03-20' } };
const PILOT: Slot = { skill: 'pilot', minLevel: 3, number: 1, headcount: 1 };

const ada = (changes: Partial<CrewInput> = {}): CrewInput => ({
  ref: 'CRW-1',
  name: 'Ada Reyes',
  status: 'active',
  skills: [{ skill: 'pilot', level: 5, certifiedUntil: null }],
  availabilityBlocks: [],
  assignments: [],
  ...changes,
});

const assignment = (changes: Partial<AssignmentInput>): AssignmentInput => ({
  ref: 'ASG-1',
  mission: { ref: 'MSN-4', name: 'Ceres Resupply', status: 'submitted', owner: 'Sam Okafor' },
  period: { from: '2027-03-10', to: '2027-03-25' },
  status: 'held',
  ...changes,
});

const reasons = (crew: CrewInput, need = PILOT) => failuresOf({ crew, need, mission: EUROPA });

describe('the hard constraints of DESIGN.md section 6.2', () => {
  it('passes a crew member who meets every one, recording nothing', () => {
    expect(reasons(ada())).toEqual([]);
  });

  it('1. leaves out a crew member who is inactive', () => {
    expect(reasons(ada({ status: 'inactive' }))).toEqual([{ constraint: 'active' }]);
  });

  it('2. leaves out a crew member without the skill, or below the level, saying which', () => {
    expect(reasons(ada({ skills: [] }))).toEqual([{ constraint: 'skill', level: null, minLevel: 3 }]);
    expect(reasons(ada({ skills: [{ skill: 'pilot', level: 2, certifiedUntil: null }] }))).toEqual([
      { constraint: 'skill', level: 2, minLevel: 3 },
    ]);
    expect(reasons(ada({ skills: [{ skill: 'pilot', level: 3, certifiedUntil: null }] }))).toEqual([]);
  });

  it('3. leaves out a crew member whose certification ends before the mission\'s last day, not on it', () => {
    const certified = (certifiedUntil: string) => ada({ skills: [{ skill: 'pilot', level: 5, certifiedUntil }] });
    // The period ends on 20 March, exclusive: its last day is 19 March.
    expect(reasons(certified('2027-03-18'))).toEqual([{ constraint: 'certification', certifiedUntil: '2027-03-18', lastDay: '2027-03-19' }]);
    expect(reasons(certified('2027-03-19'))).toEqual([]);
  });

  it('4. leaves out a crew member with an availability block over the period, and not one that only touches it', () => {
    const block = { ref: 'AVL-3', period: { from: '2027-03-05', to: '2027-03-13' } };
    expect(reasons(ada({ availabilityBlocks: [block] }))).toEqual([{ constraint: 'availability', block }]);
    // Ends the day the mission starts, and starts the day after its last day.
    const touching = [
      { ref: 'AVL-4', period: { from: '2027-02-20', to: '2027-03-01' } },
      { ref: 'AVL-5', period: { from: '2027-03-20', to: '2027-03-25' } },
    ];
    expect(reasons(ada({ availabilityBlocks: touching }))).toEqual([]);
  });

  it('5. leaves out a crew member held, offered or accepted on another mission over the period, but not one only proposed', () => {
    for (const status of LIVE_ASSIGNMENT_STATUSES) {
      const live = assignment({ status });
      expect(reasons(ada({ assignments: [live] }))).toEqual([{ constraint: 'free', assignment: live }]);
    }
    for (const status of ASSIGNMENT_STATUSES.filter((each) => !isLiveStatus(each))) {
      expect(reasons(ada({ assignments: [assignment({ status })] }))).toEqual([]);
    }
    expect(reasons(ada({ assignments: [assignment({ period: { from: '2027-04-01', to: '2027-04-10' } })] }))).toEqual([]);
  });

  it('6. leaves out a crew member who declined this mission', () => {
    const declined = assignment({ mission: { ref: 'MSN-8', name: 'Europa Survey', status: 'approved', owner: 'Sam Okafor' }, status: 'declined', period: EUROPA.period });
    expect(reasons(ada({ assignments: [declined] }))).toEqual([{ constraint: 'not_declined', assignment: declined }]);
  });

  it('leaves out a crew member already in another of this mission\'s slots, since each fills one slot at most', () => {
    const proposed = assignment({ mission: { ref: 'MSN-8', name: 'Europa Survey', status: 'draft', owner: 'Sam Okafor' }, status: 'proposed', period: EUROPA.period });
    expect(reasons(ada({ assignments: [proposed] }))).toEqual([{ constraint: 'not_on_mission', assignment: proposed }]);
  });

  it('records every constraint a crew member fails, in the order of the list', () => {
    const block = { ref: 'AVL-3', period: { from: '2027-03-05', to: '2027-03-13' } };
    expect(reasons(ada({ status: 'inactive', availabilityBlocks: [block] })).map((reason) => reason.constraint)).toEqual(['active', 'availability']);
    expect(HARD_CONSTRAINTS.map((constraint) => constraint.name)).toEqual([
      'active',
      'skill',
      'certification',
      'availability',
      'free',
      'not_declined',
      'not_on_mission',
    ]);
  });
});
