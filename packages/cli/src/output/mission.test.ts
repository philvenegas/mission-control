import type { Mission, MissionCrew } from '@mission-control/contract';
import { describe, expect, it } from 'vitest';
import { approvalProgress, crewMissionLines, historyLines, missionLines, missionListLines, nextForMission } from './mission.ts';
import { paint } from './style.ts';

const plain = paint({ isTTY: false }, {});
const SAM = { name: 'Sam Okafor', email: 'sam@artemis.example' };
const DANA = { name: 'Dana Okoye', email: 'dana@artemis.example' };
const VESTA = { ref: 'MSN-5', name: 'Vesta Mapping', status: 'draft' as const, owner: 'Priya Nair' };

function crew(assignment: string, ref: string, name: string, overrides: Partial<MissionCrew> = {}): MissionCrew {
  return { assignment, crew_member: { ref, name }, status: 'proposed', score: 0.84, match_run: 'RUN-1', assigned_by: SAM, decline_reason: null, problems: [], ...overrides };
}

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    ref: 'MSN-8',
    name: 'Europa Survey',
    description: '',
    from: '2027-03-01',
    to: '2027-03-20',
    status: 'draft',
    owner: SAM,
    submitted_by: null,
    requirements: [],
    approval: { required: 1, approved_by: [] },
    ...overrides,
  };
}

const europa = (status: Mission['status'], pilot: Partial<MissionCrew>, medic: MissionCrew[]) =>
  mission({
    status,
    requirements: [
      { skill: 'pilot', min_level: 3, headcount: 1, crew: [crew('ASG-31', 'CRW-1', 'Ada Reyes', pilot)] },
      { skill: 'medic', min_level: 3, headcount: 1, crew: medic },
    ],
  });

describe('mctl mission show', () => {
  it('prints one line per slot: the crew member, score, status, who chose them, and any problem; an open slot says so', () => {
    const ceres = mission({
      ref: 'MSN-4',
      name: 'Ceres Resupply',
      from: '2027-05-03',
      to: '2027-05-24',
      requirements: [
        {
          skill: 'pilot',
          min_level: 3,
          headcount: 2,
          crew: [crew('ASG-40', 'CRW-1', 'Ada Reyes', { score: null, match_run: null, problems: [{ kind: 'clash', mission: VESTA }] })],
        },
      ],
    });
    expect(missionLines(ceres, plain)).toEqual([
      'MSN-4  Ceres Resupply  3–24 May 2027',
      'draft · owner Sam Okafor',
      '',
      '1 of 2 slots filled',
      'pilot  level 3 or above',
      '  1 of 2  ASG-40  Ada Reyes CRW-1            proposed  chosen by Sam Okafor  ✗ clash: also proposed on MSN-5 Vesta Mapping (draft, owner Priya Nair)',
      '  2 of 2  open',
    ]);
  });

  it('marks crew chosen by the matcher, lists a decline with its reason apart from the slots, and lists who has approved', () => {
    const shown = missionLines(
      {
        ...europa('approved', { status: 'accepted' }, [
          crew('ASG-33', 'CRW-3', 'Mina Farouk', { status: 'offered', score: 0.76, match_run: 'RUN-2' }),
          crew('ASG-32', 'CRW-7', 'Quin Abara', { status: 'declined', score: 0.79, decline_reason: 'Medical leave' }),
        ]),
        description: 'Survey of the Europa ice shell.',
        submitted_by: SAM,
        approval: { required: 1, approved_by: [DANA] },
      },
      plain,
    );
    expect(shown.slice(0, 4)).toEqual(['MSN-8  Europa Survey  1–20 Mar 2027', 'approved · owner Sam Okafor · submitted by Sam Okafor', 'Approvals: 1 of 1 — Dana Okoye', 'Survey of the Europa ice shell.']);
    expect(shown.slice(5)).toEqual([
      '2 of 2 slots filled',
      'pilot  level 3 or above',
      '  1 of 1  ASG-31  Ada Reyes CRW-1    score 84  accepted  chosen by the matcher (RUN-1)',
      'medic  level 3 or above',
      '  1 of 1  ASG-33  Mina Farouk CRW-3  score 76  offered  chosen by the matcher (RUN-2)',
      '          ASG-32  Quin Abara CRW-7   score 79  declined: Medical leave  chosen by the matcher (RUN-1)',
    ]);
  });

  it('marks a decline that gave no reason', () => {
    const shown = missionLines(europa('approved', { status: 'offered' }, [crew('ASG-32', 'CRW-7', 'Quin Abara', { status: 'declined', score: 0.79 })]), plain);
    expect(shown.at(-1)).toBe('          ASG-32  Quin Abara CRW-7  score 79  declined  chosen by the matcher (RUN-1)');
  });

  it('says how many approvals a submitted mission has, and when it has no requirements', () => {
    expect(missionLines(mission({ status: 'submitted', approval: { required: 2, approved_by: [] } }), plain)).toEqual([
      'MSN-8  Europa Survey  1–20 Mar 2027',
      'submitted · owner Sam Okafor',
      'Approvals: 0 of 2',
      '',
      'No requirements yet.',
    ]);
  });
});

describe('mctl mission list', () => {
  it('prints a line per mission and marks a clash, naming the crew member, the other mission and its owner', () => {
    const ceres = mission({
      ref: 'MSN-4',
      name: 'Ceres Resupply',
      from: '2027-05-03',
      to: '2027-05-24',
      requirements: [
        {
          skill: 'pilot',
          min_level: 3,
          headcount: 1,
          crew: [crew('ASG-40', 'CRW-1', 'Ada Reyes', { problems: [{ kind: 'clash', mission: VESTA }, { kind: 'hard_constraint', failure: { constraint: 'active' } }] })],
        },
      ],
    });
    expect(missionListLines([ceres, mission()], plain)).toEqual([
      'MSN-4  Ceres Resupply  3–24 May 2027  draft  Sam Okafor  1 of 1 filled  ✗ clash: Ada Reyes also on MSN-5 (Priya Nair)  ✗ 1 other problem',
      'MSN-8  Europa Survey   1–20 Mar 2027  draft  Sam Okafor  0 of 0 filled',
    ]);
    expect(missionListLines([], plain)).toEqual(['No missions yet.']);
    const twoProblems = mission({
      requirements: [
        {
          skill: 'pilot',
          min_level: 3,
          headcount: 1,
          crew: [crew('ASG-40', 'CRW-1', 'Ada Reyes', { problems: [{ kind: 'hard_constraint', failure: { constraint: 'active' } }, { kind: 'hard_constraint', failure: { constraint: 'active' } }] })],
        },
      ],
    });
    expect(missionListLines([twoProblems], plain)).toEqual(['MSN-8  Europa Survey  1–20 Mar 2027  draft  Sam Okafor  1 of 1 filled  ✗ 2 other problems']);
  });

  it('shows a crew member only their own slot on each mission', () => {
    const offered = { ref: 'MSN-8', name: 'Europa Survey', from: '2027-03-01', to: '2027-03-20', slot: { assignment: 'ASG-31', skill: 'pilot', status: 'offered' as const } };
    expect(crewMissionLines([offered])).toEqual(['MSN-8  Europa Survey  1–20 Mar 2027  pilot  offered  ASG-31']);
    expect(crewMissionLines([])).toEqual(['No missions you are offered or accepted on.']);
  });
});

describe('mctl mission approve', () => {
  it('reports progress while more approvals are needed', () => {
    const submitted = mission({ status: 'submitted', approval: { required: 2, approved_by: [DANA] } });
    expect(approvalProgress(submitted)).toBe('Approved (1 of 2). MSN-8 stays submitted until one more director approves.');
    expect(approvalProgress({ ...submitted, approval: { required: 3, approved_by: [DANA] } })).toBe('Approved (1 of 3). MSN-8 stays submitted until 2 more directors approve.');
  });
});

describe('mctl mission history', () => {
  it('prints who did what and when, with each move and note', () => {
    expect(
      historyLines(
        [
          { type: 'submit', from_status: 'draft', to_status: 'submitted', actor: SAM, note: null, at: '2026-10-03T10:00:00.000Z' },
          { type: 'clash', from_status: null, to_status: null, actor: SAM, note: 'Ada Reyes CRW-1 is now also proposed on MSN-9.', at: '2026-10-03T10:05:00.000Z' },
        ],
      ),
    ).toEqual([
      '2026-10-03 10:00 UTC  submit  draft → submitted  Sam Okafor',
      '2026-10-03 10:05 UTC  clash                      Sam Okafor  “Ada Reyes CRW-1 is now also proposed on MSN-9.”',
    ]);
  });
});

describe('the next command after a mission is shown', () => {
  const placed = crew('ASG-31', 'CRW-1', 'Ada Reyes');
  it('follows the mission through its lifecycle', () => {
    expect(nextForMission(mission())).toBe('mctl mission require MSN-8 --skill <skill> --level <level>');
    expect(nextForMission(europa('draft', {}, []))).toBe('mctl match run MSN-8');
    expect(nextForMission(europa('draft', { problems: [{ kind: 'clash', mission: VESTA }] }, [placed]))).toBe('mctl assignment remove ASG-31');
    expect(nextForMission(europa('draft', {}, [placed]))).toBe('mctl mission submit MSN-8');
    expect(nextForMission(europa('submitted', {}, [placed]))).toBe('mctl mission approve MSN-8');
    expect(nextForMission(europa('approved', { status: 'accepted' }, [{ ...placed, status: 'declined' }]))).toBe('mctl match run MSN-8');
    expect(nextForMission(europa('approved', { status: 'accepted' }, [{ ...placed, status: 'offered' }]))).toBeNull();
    expect(nextForMission(europa('approved', { status: 'accepted' }, [{ ...placed, status: 'accepted' }]))).toBe('mctl mission launch MSN-8');
    expect(nextForMission(mission({ status: 'active' }))).toBe('mctl mission complete MSN-8');
    expect(nextForMission(mission({ status: 'completed' }))).toBe('mctl mission history MSN-8');
    expect(nextForMission(mission({ status: 'cancelled' }))).toBe('mctl mission history MSN-8');
  });
});
