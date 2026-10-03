import { describe, expect, it } from 'vitest';
import { counted, describeFailure, describeProblem, formatDay, formatPeriod, outOf100 } from './words.ts';

const PHOBOS = { ref: 'MSN-3', name: 'Phobos Survey', status: 'submitted' as const, owner: 'Priya Nair' };
const onPhobos = (status: 'held' | 'offered' | 'accepted' | 'proposed' | 'declined' | 'released') => ({
  ref: 'ASG-9',
  mission: PHOBOS,
  from: '2027-06-01',
  to: '2027-06-30',
  status,
});

describe('dates in words', () => {
  it('writes a period with both ends as stored, saying a shared month and year once', () => {
    expect(formatPeriod('2027-03-01', '2027-03-20')).toBe('1–20 Mar 2027');
    expect(formatPeriod('2027-04-04', '2027-05-02')).toBe('4 Apr – 2 May 2027');
    expect(formatPeriod('2026-10-15', '2027-02-10')).toBe('15 Oct 2026 – 10 Feb 2027');
    expect(formatPeriod('2027-03-05', '2027-03-12', false)).toBe('5–12 Mar');
    expect(formatPeriod('2027-04-04', '2027-05-02', false)).toBe('4 Apr – 2 May');
  });

  it('writes a day, with or without its year', () => {
    expect(formatDay('2027-03-10')).toBe('10 Mar 2027');
    expect(formatDay('2027-03-10', false)).toBe('10 Mar');
  });
});

describe('a failed hard constraint in words', () => {
  it('says what the crew member lacks, leaving out the year of a date in the mission\'s year', () => {
    expect(describeFailure({ constraint: 'active' }, 'pilot', '2027')).toBe('inactive');
    expect(describeFailure({ constraint: 'skill', level: null, min_level: 3 }, 'pilot', '2027')).toBe('does not have pilot');
    expect(describeFailure({ constraint: 'skill', level: 2, min_level: 3 }, 'pilot', '2027')).toBe('pilot level 2, needs 3');
    expect(describeFailure({ constraint: 'certification', certified_until: '2027-03-10', last_day: '2027-03-19' }, 'medic', '2027')).toBe(
      'medic certification expires 10 Mar, before the mission ends',
    );
    expect(describeFailure({ constraint: 'availability', block: { ref: 'AVL-3', from: '2026-12-20', to: '2027-01-05' } }, 'medic', '2027')).toBe(
      'availability block AVL-3, 20 Dec 2026 – 5 Jan 2027',
    );
    expect(describeFailure({ constraint: 'not_declined', assignment: onPhobos('declined') }, 'medic', '2027')).toBe('declined MSN-3');
    expect(describeFailure({ constraint: 'not_on_mission', assignment: onPhobos('proposed') }, 'medic', '2027')).toBe(
      'already in another slot of this mission (ASG-9)',
    );
  });

  it('names the other mission a crew member is on, with how they stand on it', () => {
    const on = (status: Parameters<typeof onPhobos>[0]) => describeFailure({ constraint: 'free', assignment: onPhobos(status) }, 'medic', '2027');
    expect(on('held')).toBe('held by MSN-3 Phobos Survey (submitted, owner Priya Nair), 1–30 Jun');
    expect(on('offered')).toBe('offered a place on MSN-3 Phobos Survey (submitted, owner Priya Nair), 1–30 Jun');
    expect(on('accepted')).toBe('on MSN-3 Phobos Survey (submitted, owner Priya Nair), 1–30 Jun');
    expect(on('proposed')).toBe('proposed on MSN-3 Phobos Survey (submitted, owner Priya Nair), 1–30 Jun');
    expect(on('declined')).toBe('declined MSN-3 Phobos Survey (submitted, owner Priya Nair), 1–30 Jun');
    expect(on('released')).toBe('released from MSN-3 Phobos Survey (submitted, owner Priya Nair), 1–30 Jun');
  });

  it('names a clash by the other mission, and any other problem by the constraint', () => {
    expect(describeProblem({ kind: 'clash', mission: { ...PHOBOS, status: 'draft' } }, 'pilot', '2027')).toBe(
      'clash: also proposed on MSN-3 Phobos Survey (draft, owner Priya Nair)',
    );
    expect(describeProblem({ kind: 'hard_constraint', failure: { constraint: 'active' } }, 'pilot', '2027')).toBe('inactive');
  });
});

describe('numbers in words', () => {
  it('gives a score out of 100, and a count with its noun', () => {
    expect(outOf100(0.8378)).toBe(84);
    expect(counted(1, 'slot')).toBe('1 slot');
    expect(counted(2, 'slot')).toBe('2 slots');
    expect(counted(2, 'more director', 'more directors')).toBe('2 more directors');
  });
});
