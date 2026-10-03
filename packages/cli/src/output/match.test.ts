import { DEFAULT_MATCH_WEIGHTS, type MatchRun } from '@mission-control/contract';
import { describe, expect, it } from 'vitest';
import { MAX_EXCLUDED_SHOWN, matchRunFooter, matchRunLines, type RunMission } from './match.ts';
import { paint } from './style.ts';

// The match run output of DESIGN.md section 8, from runs built to give the design's own numbers.

const plain = paint({ isTTY: false }, {});
const coloured = paint({ isTTY: true }, {});

const EUROPA: RunMission = { ref: 'MSN-8', name: 'Europa Survey', from: '2027-03-01', to: '2027-03-20', status: 'draft' };
const TITAN: RunMission = { ref: 'MSN-6', name: 'Titan Relay', from: '2027-04-04', to: '2027-04-30', status: 'draft' };

const { proficiency, workload, rest } = DEFAULT_MATCH_WEIGHTS;

/** A chosen crew member's score, built the way the matcher builds it. */
function score(level: number, minLevel: number, daysAssigned: number, daysRested: number | null) {
  const values = { proficiency: 0.6 + 0.1 * (level - minLevel), workload: 1 - daysAssigned / 180, rest: daysRested === null ? 1 : Math.min(daysRested, 30) / 30 };
  const components = [
    { name: 'proficiency' as const, value: values.proficiency, weight: proficiency, points: values.proficiency * proficiency, level },
    { name: 'workload' as const, value: values.workload, weight: workload, points: values.workload * workload, days_assigned: daysAssigned, window_days: 180 },
    { name: 'rest' as const, value: values.rest, weight: rest, points: values.rest * rest, days_rested: daysRested },
  ];
  return { total: components.reduce((sum, component) => sum + component.points, 0), components };
}

const crew = (ref: string, name: string) => ({ ref, name });
const ADA = crew('CRW-1', 'Ada Reyes');

function run(overrides: Partial<MatchRun>): MatchRun {
  return {
    ref: 'RUN-1',
    mission: 'MSN-8',
    created_by: { name: 'Sam Okafor', email: 'sam@artemis.example' },
    created_at: '2026-10-03T10:00:00.000Z',
    applied_at: null,
    weights: DEFAULT_MATCH_WEIGHTS,
    slots: [],
    ruled_out: [],
    summary: { slots: 0, already_filled: 0, open: 0, filled: 0, clashes: 0 },
    ...overrides,
  };
}

const europaRun = run({
  slots: [
    {
      slot: { skill: 'pilot', min_level: 3, number: 1, headcount: 1 },
      chosen: { crew_member: ADA, score: score(5, 3, 20, 25), clashes: [] },
      alternates: [
        { crew_member: crew('CRW-2', 'Ben Osei'), score: 0.79, chosen_for_another_slot: false, clashes: [] },
        { crew_member: crew('CRW-9', 'Cy Lindqvist'), score: 0.57, chosen_for_another_slot: false, clashes: [] },
      ],
      unfilled: null,
    },
    {
      slot: { skill: 'medic', min_level: 3, number: 1, headcount: 1 },
      chosen: { crew_member: crew('CRW-7', 'Quin Abara'), score: score(3, 3, 15, 30), clashes: [] },
      alternates: [{ crew_member: crew('CRW-3', 'Mina Farouk'), score: 0.76, chosen_for_another_slot: false, clashes: [] }],
      unfilled: null,
    },
  ],
  ruled_out: [
    { crew_member: crew('CRW-5', 'Omar Vance'), skill: 'medic', failures: [{ constraint: 'availability', block: { ref: 'AVL-3', from: '2027-03-05', to: '2027-03-12' } }] },
    {
      crew_member: crew('CRW-4', 'Noor Haddad'),
      skill: 'medic',
      failures: [{ constraint: 'certification', certified_until: '2027-03-10', last_day: '2027-03-19' }],
    },
  ],
  summary: { slots: 2, already_filled: 0, open: 2, filled: 2, clashes: 0 },
});

const titanRun = run({
  ref: 'RUN-2',
  mission: 'MSN-6',
  slots: [
    {
      slot: { skill: 'geologist', min_level: 4, number: 1, headcount: 2 },
      chosen: { crew_member: crew('CRW-10', 'Rosa Imani'), score: score(4, 4, 0, null), clashes: [] },
      alternates: [],
      unfilled: null,
    },
    {
      slot: { skill: 'geologist', min_level: 4, number: 2, headcount: 2 },
      chosen: null,
      alternates: [],
      unfilled: {
        lost_to: [
          { reason: 'no_skill', count: 9 },
          { reason: 'below_level', count: 1 },
          { reason: 'availability', count: 1 },
        ],
        nearest_misses: [
          { crew_member: crew('CRW-12', 'Tala Moreno'), level: 5, failures: [{ constraint: 'availability', block: { ref: 'AVL-8', from: '2027-04-01', to: '2027-04-14' } }] },
          { crew_member: crew('CRW-11', 'Sven Dahl'), level: 3, failures: [{ constraint: 'skill', level: 3, min_level: 4 }] },
        ],
      },
    },
  ],
  summary: { slots: 2, already_filled: 0, open: 2, filled: 1, clashes: 0 },
});

const text = (lines: string[]) => lines.join('\n');

describe('mctl match run, as DESIGN.md section 8 prints it', () => {
  it('prints the verdict first, a block per slot with the score in words and the alternates, those excluded with the skill, and the footer', () => {
    expect(text([...matchRunLines(europaRun, EUROPA, plain), ...matchRunFooter(europaRun, plain)])).toBe(
      [
        'MSN-8  Europa Survey  1–20 Mar 2027',
        '✓ 2 of 2 slots filled',
        '',
        'pilot  level 3 or above',
        '  → Ada Reyes CRW-1   score 84',
        '    level 5 (36 of 45) · 20 of 180 days assigned (31 of 35) · 25 days rested (17 of 20)',
        '    alternates: Ben Osei 79, Cy Lindqvist 57',
        '',
        'medic  level 3 or above',
        '  → Quin Abara CRW-7   score 79',
        '    level 3 (27 of 45) · 15 of 180 days assigned (32 of 35) · 30 days rested (20 of 20)',
        '    alternates: Mina Farouk 76',
        '',
        'Excluded with the skill:',
        '  CRW-5 Omar Vance — availability block AVL-3, 5–12 Mar',
        '  CRW-4 Noor Haddad — medic certification expires 10 Mar, before the mission ends',
        '',
        'Saved as RUN-1. Nothing has changed yet.',
        '  Apply it:      mctl match apply RUN-1',
        '  Pick another:  mctl assignment add MSN-8 --crew CRW-2 --skill pilot',
      ].join('\n'),
    );
  });

  it('explains an unfilled slot: the count lost to each reason, the two nearest misses, and the commands that would fill it', () => {
    expect(text(matchRunLines(titanRun, TITAN, plain))).toBe(
      [
        'MSN-6  Titan Relay  4–30 Apr 2027',
        '! 1 of 2 slots filled',
        '',
        'geologist 1 of 2  level 4 or above',
        '  → Rosa Imani CRW-10   score 82',
        '    level 4 (27 of 45) · 0 of 180 days assigned (35 of 35) · never flown (20 of 20)',
        '',
        'geologist 2 of 2  level 4 or above',
        '  ✗ unfilled — nobody qualifies: 1 below level 4, 1 has an availability block, 9 do not have geologist',
        '    nearest: CRW-12 Tala Moreno — geologist level 5, availability block AVL-8, 1–14 Apr',
        '    nearest: CRW-11 Sven Dahl — geologist level 3, needs 4',
        '    lower the level:  mctl mission require MSN-6 --skill geologist --level 3 --count 2',
        '    or the headcount: mctl mission require MSN-6 --skill geologist --level 4 --count 1',
      ].join('\n'),
    );
  });

  it('suggests dropping a requirement none of whose slots it filled, and gives no commands once the mission is past draft', () => {
    const [, unfilledSlot] = titanRun.slots;
    if (!unfilledSlot?.unfilled) throw new Error('The fixture has an unfilled slot');
    const noneFilled = run({
      slots: [{ ...unfilledSlot, slot: { ...unfilledSlot.slot, number: 1, headcount: 1 }, unfilled: { ...unfilledSlot.unfilled, nearest_misses: [] } }],
      summary: { slots: 1, already_filled: 0, open: 1, filled: 0, clashes: 0 },
    });
    expect(matchRunLines(noneFilled, TITAN, plain).slice(-2)).toEqual([
      '  ✗ unfilled — nobody qualifies: 1 below level 4, 1 has an availability block, 9 do not have geologist',
      '    drop it: mctl mission unrequire MSN-6 --skill geologist',
    ]);
    expect(matchRunLines(noneFilled, { ...TITAN, status: 'approved' }, plain).at(-1)).toBe(
      '  ✗ unfilled — nobody qualifies: 1 below level 4, 1 has an availability block, 9 do not have geologist',
    );
    expect(matchRunFooter(noneFilled, plain)).toEqual(['', 'Saved as RUN-1. It fills no slot, so there is nothing to apply.']);
  });

  it('offers to lower the headcount when no nearest miss lacks only level, and to drop a requirement whose level is the only fix', () => {
    const [filledSlot, unfilledSlot] = titanRun.slots;
    if (!filledSlot || !unfilledSlot?.unfilled) throw new Error('The fixture has a filled and an unfilled slot');
    const [tala, sven] = unfilledSlot.unfilled.nearest_misses;
    if (!tala || !sven) throw new Error('The fixture has two nearest misses');
    const onlyTala = run({ slots: [filledSlot, { ...unfilledSlot, unfilled: { ...unfilledSlot.unfilled, nearest_misses: [tala] } }] });
    expect(matchRunLines(onlyTala, TITAN, plain).at(-1)).toBe('    lower the headcount: mctl mission require MSN-6 --skill geologist --level 4 --count 1');
    const onlySven = run({ slots: [{ ...unfilledSlot, slot: { ...unfilledSlot.slot, number: 1, headcount: 1 }, unfilled: { ...unfilledSlot.unfilled, nearest_misses: [sven] } }] });
    expect(matchRunLines(onlySven, TITAN, plain).slice(-2)).toEqual([
      '    lower the level: mctl mission require MSN-6 --skill geologist --level 3 --count 1',
      '    or drop it:      mctl mission unrequire MSN-6 --skill geologist',
    ]);
    const nobody = run({ slots: [{ ...unfilledSlot, unfilled: { lost_to: [], nearest_misses: [] } }] });
    expect(matchRunLines(nobody, { ...TITAN, status: 'approved' }, plain).at(-1)).toBe('  ✗ unfilled — nobody qualifies');
    // An unfilled slot has nobody to pick instead.
    expect(matchRunFooter(titanRun, plain)).toEqual(['', 'Saved as RUN-2. Nothing has changed yet.\n  Apply it:      mctl match apply RUN-2']);
  });

  it('puts every reason a crew member was lost into words, singular and plural', () => {
    const [, unfilledSlot] = titanRun.slots;
    if (!unfilledSlot?.unfilled) throw new Error('The fixture has an unfilled slot');
    const reasons = ['active', 'certification', 'free', 'not_declined', 'not_on_mission', 'chosen_for_another_slot'] as const;
    const reasonsRun = (count: number) =>
      run({ slots: [{ ...unfilledSlot, unfilled: { lost_to: reasons.map((reason) => ({ reason, count })), nearest_misses: [] } }] });
    expect(matchRunLines(reasonsRun(1), { ...TITAN, status: 'approved' }, plain).at(-1)).toBe(
      '  ✗ unfilled — nobody qualifies: 1 is inactive, 1 has a geologist certification that expires too soon, 1 is on another mission then, 1 declined this mission, 1 is already in another slot, 1 fills another slot',
    );
    expect(matchRunLines(reasonsRun(2), { ...TITAN, status: 'approved' }, plain).at(-1)).toBe(
      '  ✗ unfilled — nobody qualifies: 2 are inactive, 2 have a geologist certification that expires too soon, 2 are on another mission then, 2 declined this mission, 2 are already in other slots, 2 fill other slots',
    );
  });

  it('warns of a clash the run could not avoid, naming the other mission, its status and its owner', () => {
    const vesta = { ref: 'MSN-5', name: 'Vesta Mapping', status: 'draft' as const, owner: 'Priya Nair' };
    const [pilot] = europaRun.slots;
    if (!pilot?.chosen) throw new Error('The fixture chose a pilot');
    const clashing = run({ slots: [{ ...pilot, chosen: { ...pilot.chosen, clashes: [vesta] }, alternates: [] }], summary: { slots: 1, already_filled: 0, open: 1, filled: 1, clashes: 1 } });
    expect(matchRunLines(clashing, EUROPA, plain)).toContain(
      '    ⚠ clash: also proposed on MSN-5 Vesta Mapping (draft, owner Priya Nair). Neither mission can be submitted until one lets Ada Reyes go.',
    );
  });

  it('marks an alternate chosen for another slot, or who would clash, and offers to pick only one who is free', () => {
    const [pilot, medic] = europaRun.slots;
    if (!pilot || !medic) throw new Error('The fixture has two slots');
    const vesta = { ref: 'MSN-5', name: 'Vesta Mapping', status: 'draft' as const, owner: 'Priya Nair' };
    const marked = run({
      slots: [
        { ...pilot, alternates: [{ crew_member: crew('CRW-2', 'Ben Osei'), score: 0.79, chosen_for_another_slot: false, clashes: [vesta] }] },
        { ...medic, alternates: [{ crew_member: ADA, score: 0.82, chosen_for_another_slot: true, clashes: [] }] },
      ],
      summary: { slots: 2, already_filled: 0, open: 2, filled: 2, clashes: 0 },
    });
    const lines = matchRunLines(marked, EUROPA, plain);
    expect(lines).toContain('    alternates: Ben Osei 79 (clash with MSN-5)');
    expect(lines).toContain('    alternates: Ada Reyes 82 (chosen for pilot)');
    expect(matchRunFooter(marked, plain)).toEqual(['', 'Saved as RUN-1. Nothing has changed yet.\n  Apply it:      mctl match apply RUN-1']);
  });

  it('counts the slots already filled in the verdict, as when a run refills a declined slot', () => {
    const [, medic] = europaRun.slots;
    if (!medic) throw new Error('The fixture has a medic slot');
    const refill = run({ slots: [medic], summary: { slots: 2, already_filled: 1, open: 1, filled: 1, clashes: 0 } });
    expect(matchRunLines(refill, { ...EUROPA, status: 'approved' }, plain)[1]).toBe('✓ 2 of 2 slots filled');
  });

  it('names at most five crew excluded with the skill, then counts the rest', () => {
    const omar = europaRun.ruled_out[0];
    if (!omar) throw new Error('The fixture rules out Omar');
    const more = 2;
    const many = run({ ruled_out: Array.from({ length: MAX_EXCLUDED_SHOWN + more }, (_, index) => ({ ...omar, crew_member: crew(`CRW-${index + 20}`, `Crew ${index + 1}`) })) });
    const excluded = matchRunLines(many, EUROPA, plain).at(-1)?.split('\n');
    // The heading, those named, and the count of the rest.
    expect(excluded).toHaveLength(1 + MAX_EXCLUDED_SHOWN + 1);
    expect(excluded?.at(-1)).toBe(`  and ${more} more`);
  });

  it('says when an applied run was applied, instead of offering to apply it', () => {
    expect(matchRunFooter({ ...europaRun, applied_at: '2026-10-03T10:05:00.000Z' }, plain)).toEqual(['', 'RUN-1 was applied at 2026-10-03 10:05 UTC.']);
  });

  it('colours the verdict green when full, amber when not, in a terminal', () => {
    expect(matchRunLines(europaRun, EUROPA, coloured)[1]).toBe('\u001b[32m✓ 2 of 2 slots filled\u001b[39m');
    expect(matchRunLines(titanRun, TITAN, coloured)[1]).toBe('\u001b[33m! 1 of 2 slots filled\u001b[39m');
  });
});
