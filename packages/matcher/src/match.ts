import { parseRef } from '@mission-control/contract';
import { type ConstraintFailure, failuresOf, HARD_CONSTRAINTS } from './constraints.ts';
import {
  assignmentsElsewhere,
  type Consideration,
  type CrewInput,
  type MatchedMission,
  type MatchInput,
  type MissionSummary,
  type RequirementInput,
  type Slot,
} from './input.ts';
import { type Score, scoreCandidate } from './scorers.ts';
import { solveAssignment } from './solver.ts';

/** A crew member as an output names them. */
export interface CrewMemberSummary {
  ref: string;
  name: string;
}

export interface ChosenCrewMember {
  crewMember: CrewMemberSummary;
  score: Score;
  /** Other drafts over the same period that propose this crew member; empty unless no clash-free crew existed. */
  clashes: MissionSummary[];
}

export interface Alternate {
  crewMember: CrewMemberSummary;
  score: number;
  chosenForAnotherSlot: boolean;
  clashes: MissionSummary[];
}

/** Why a crew member was lost to a slot: the first constraint they failed, or that they were needed elsewhere. */
export type LossReason = Exclude<ConstraintFailure['constraint'], 'skill'> | 'no_skill' | 'below_level' | 'chosen_for_another_slot';

export interface NearestMiss {
  crewMember: CrewMemberSummary;
  /** Everything they lack for the slot. */
  failures: ConstraintFailure[];
}

export interface SlotResult {
  slot: Slot;
  chosen: ChosenCrewMember | null;
  /** Up to three other candidates, best first. */
  alternates: Alternate[];
  /** For a slot left unfilled: how many crew were lost to each reason, and the two nearest misses. */
  unfilled: { lostTo: { reason: LossReason; count: number }[]; nearestMisses: NearestMiss[] } | null;
}

export interface RuledOutCrewMember {
  crewMember: CrewMemberSummary;
  skill: string;
  failures: ConstraintFailure[];
}

export interface MatchOutput {
  slots: SlotResult[];
  /** Crew who hold the skill an open slot needs but are not candidates for it, with why. */
  ruledOut: RuledOutCrewMember[];
  summary: { slots: number; alreadyFilled: number; open: number; filled: number; clashes: number };
}

/** Costs are whole numbers: a score is counted in millionths. */
const SCALE = 1_000_000;
const MAX_ALTERNATES = 3;
const MAX_NEAREST_MISSES = 2;

const LOSS_ORDER: readonly LossReason[] = [
  ...HARD_CONSTRAINTS.flatMap(({ name }): LossReason[] => (name === 'skill' ? ['no_skill', 'below_level'] : [name])),
  'chosen_for_another_slot',
];

function crewNumber(crew: CrewInput): number {
  const number = parseRef('crew_member', crew.ref);
  if (number === null) throw new Error(`"${crew.ref}" is not a crew member's reference`);
  return number;
}
const summarise = (crew: CrewInput): CrewMemberSummary => ({ ref: crew.ref, name: crew.name });

/** The open slots of the requirements: those past the ones already filled. */
const openSlots = (requirements: readonly RequirementInput[]): Slot[] =>
  requirements.flatMap(({ skill, minLevel, headcount, filled }) =>
    Array.from({ length: Math.max(0, headcount - filled) }, (_, index) => ({ skill, minLevel, number: filled + index + 1, headcount })),
  );

/**
 * The other drafts over this period that propose the crew member: each a clash if they are chosen.
 * Only drafts clash: on a mission past draft, a proposal elsewhere is the other mission's problem.
 */
const clashesOf = (crew: CrewInput, mission: MatchedMission): MissionSummary[] =>
  mission.status === 'draft' ? assignmentsElsewhere(crew, mission, ['proposed']).map((assignment) => assignment.mission) : [];

const lossReason = ([first]: ConstraintFailure[]): LossReason => {
  if (!first) return 'chosen_for_another_slot';
  if (first.constraint !== 'skill') return first.constraint;
  return first.level === null ? 'no_skill' : 'below_level';
};

/** How many levels short of the slot a crew member who holds its skill is; none when they meet it. */
const levelsShort = (failures: ConstraintFailure[]) =>
  failures.reduce((short, failure) => (failure.constraint === 'skill' && failure.level !== null ? failure.minLevel - failure.level : short), 0);

/** Whether a crew member holds the slot's skill at some level: a near miss, rather than a stranger to it. */
const holdsTheSkill = (failures: ConstraintFailure[]) => !failures.some((failure) => failure.constraint === 'skill' && failure.level === null);

/** One crew member considered for one slot: why they are not a candidate, or their score. */
interface Pairing {
  crew: CrewInput;
  column: number;
  failures: ConstraintFailure[];
  score: Score | null;
  clashes: MissionSummary[];
}

/** A pairing that passed every hard constraint, and so has a score. */
type CandidatePairing = Pairing & { score: Score };
const isCandidate = (pairing: Pairing): pairing is CandidatePairing => pairing.score !== null;

/**
 * Proposes crew for a mission's open slots, and explains the proposal (DESIGN.md section 6). Pure:
 * the same input always gives the same result. Slots are filled by priority: as many as possible,
 * then with as few clashes as possible, then with the best total score.
 */
export function match(input: MatchInput): MatchOutput {
  const { mission } = input;
  // By skill name, compared as plain text so that no locale can change the order.
  const requirements = [...input.requirements].sort((a, b) => Number(a.skill > b.skill) - Number(a.skill < b.skill));
  const crew = input.crew
    .map((crewMember) => ({ crewMember, number: crewNumber(crewMember) }))
    .sort((a, b) => a.number - b.number)
    .map(({ crewMember }) => crewMember);
  const slots = openSlots(requirements);

  const rows = slots.map((slot) => ({
    slot,
    pairings: crew.map((crewMember, column): Pairing => {
      const consideration: Consideration = { crew: crewMember, need: slot, mission };
      const failures = failuresOf(consideration);
      return {
        crew: crewMember,
        column,
        failures,
        score: failures.length === 0 ? scoreCandidate(consideration, input.weights) : null,
        clashes: clashesOf(crewMember, mission),
      };
    }),
  }));

  // DESIGN.md section 6.5: an S × (C + S) matrix of whole-number costs. Each slot has its own
  // "unfilled" column; a clash costs more than any clash-free crew; leaving a slot unfilled costs
  // more than any crew at all; a forbidden pair costs more still. Infinity is never used.
  const slotCount = slots.length;
  const CLASH = slotCount * SCALE + 1;
  const UNFILLED = slotCount * (CLASH + SCALE) + 1;
  const FORBIDDEN = 2 * UNFILLED;
  const cost = rows.map(({ pairings }, slotIndex) => [
    ...pairings.map(({ score, clashes }) => (score === null ? FORBIDDEN : Math.round((1 - score.total) * SCALE) + (clashes.length > 0 ? CLASH : 0))),
    ...slots.map((_, unfilledColumn) => (unfilledColumn === slotIndex ? UNFILLED : FORBIDDEN)),
  ]);
  const answer = solveAssignment(cost);

  const chosenColumns = new Set(answer.filter((column) => column < crew.length));
  const results = rows.map(({ slot, pairings }, slotIndex): SlotResult => {
    const candidates = pairings.filter(isCandidate);
    const chosen = candidates.find((pairing) => pairing.column === answer[slotIndex]);
    const alternates = candidates
      .filter((pairing) => pairing !== chosen)
      .sort((a, b) => b.score.total - a.score.total || a.column - b.column)
      .slice(0, MAX_ALTERNATES);
    return {
      slot,
      chosen: chosen ? { crewMember: summarise(chosen.crew), score: chosen.score, clashes: chosen.clashes } : null,
      alternates: alternates.map((pairing) => ({
        crewMember: summarise(pairing.crew),
        score: pairing.score.total,
        chosenForAnotherSlot: chosenColumns.has(pairing.column),
        clashes: pairing.clashes,
      })),
      unfilled: chosen ? null : explainUnfilled(pairings),
    };
  });

  const slotResults = orderWithinRequirements(results);
  return {
    slots: slotResults,
    ruledOut: ruledOutWithSkill(requirements.filter((requirement) => requirement.filled < requirement.headcount), crew, mission),
    summary: {
      slots: requirements.reduce((sum, requirement) => sum + requirement.headcount, 0),
      alreadyFilled: requirements.reduce((sum, requirement) => sum + Math.min(requirement.filled, requirement.headcount), 0),
      open: slots.length,
      filled: slotResults.filter((result) => result.chosen).length,
      clashes: slotResults.filter((result) => result.chosen !== null && result.chosen.clashes.length > 0).length,
    },
  };
}

function explainUnfilled(pairings: Pairing[]): NonNullable<SlotResult['unfilled']> {
  const lost = pairings.map((pairing) => lossReason(pairing.failures));
  const lostTo = LOSS_ORDER.map((reason) => ({ reason, count: lost.filter((each) => each === reason).length })).filter(({ count }) => count > 0);
  // Those who hold the skill, fewest failures first, then the fewest levels short.
  const nearestMisses = pairings
    .filter((pairing) => pairing.failures.length > 0 && holdsTheSkill(pairing.failures))
    .sort((a, b) => a.failures.length - b.failures.length || levelsShort(a.failures) - levelsShort(b.failures) || a.column - b.column)
    .slice(0, MAX_NEAREST_MISSES)
    .map((pairing) => ({ crewMember: summarise(pairing.crew), failures: pairing.failures }));
  return { lostTo, nearestMisses };
}

/** Slots of one requirement are interchangeable: filled ones first, best score first, numbered in that order. */
function orderWithinRequirements(results: SlotResult[]): SlotResult[] {
  const bySkill = new Map<string, SlotResult[]>();
  for (const result of results) bySkill.set(result.slot.skill, [...(bySkill.get(result.slot.skill) ?? []), result]);
  return [...bySkill.values()].flatMap((group) => {
    const firstNumber = Math.min(...group.map((result) => result.slot.number));
    const filled = group
      .flatMap((result) => (result.chosen ? [{ result, total: result.chosen.score.total }] : []))
      .sort((a, b) => b.total - a.total)
      .map(({ result }) => result);
    const unfilled = group.filter((result) => !result.chosen);
    return [...filled, ...unfilled].map((result, index) => ({ ...result, slot: { ...result.slot, number: firstNumber + index } }));
  });
}

/**
 * Crew who hold the skill an open slot needs but are not candidates for it, once per crew member and
 * skill. Crew already in one of the mission's slots are placed, not ruled out, so they are left off.
 */
function ruledOutWithSkill(openRequirements: RequirementInput[], crew: CrewInput[], mission: MatchedMission): RuledOutCrewMember[] {
  return crew.flatMap((crewMember) =>
    openRequirements
      .filter((requirement) => crewMember.skills.some((held) => held.skill === requirement.skill))
      .flatMap((requirement) => {
        const failures = failuresOf({ crew: crewMember, need: requirement, mission });
        const placed = failures.some((failure) => failure.constraint === 'not_on_mission');
        return failures.length > 0 && !placed ? [{ crewMember: summarise(crewMember), skill: requirement.skill, failures }] : [];
      }),
  );
}
