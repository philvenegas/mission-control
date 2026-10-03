import { z } from 'zod';
import { crewMemberSummarySchema } from './assignment.ts';
import { ASSIGNMENT_STATUSES, matchWeightsSchema, MISSION_STATUSES } from './domain.ts';
import { namedUserSchema } from './mission.ts';
import { isoDaySchema } from './period.ts';

// A match run as the API gives it (DESIGN.md section 6.6): the matcher's proposal for a mission's
// open slots, and its explanation, as data. The CLI puts the reasons into words.

/** Another mission, as an explanation names it: a clash names it with its status and owner. */
const missionSummarySchema = z.object({ ref: z.string(), name: z.string(), status: z.enum(MISSION_STATUSES), owner: z.string() });

/** One of a crew member's assignments, as a reason names it. */
const assignmentSummarySchema = z.object({
  ref: z.string(),
  mission: missionSummarySchema,
  from: isoDaySchema,
  to: isoDaySchema,
  status: z.enum(ASSIGNMENT_STATUSES),
});

/** The hard constraint a crew member failed for a slot (DESIGN.md section 6.2), with what failed it. */
export const constraintFailureSchema = z.discriminatedUnion('constraint', [
  z.object({ constraint: z.literal('active') }),
  /** `level` is null when the crew member does not hold the skill at all. */
  z.object({ constraint: z.literal('skill'), level: z.number().int().nullable(), min_level: z.number().int() }),
  z.object({ constraint: z.literal('certification'), certified_until: isoDaySchema, last_day: isoDaySchema }),
  z.object({ constraint: z.literal('availability'), block: z.object({ ref: z.string(), from: isoDaySchema, to: isoDaySchema }) }),
  /** Held, offered or accepted on another mission over the period. */
  z.object({ constraint: z.literal('free'), assignment: assignmentSummarySchema }),
  z.object({ constraint: z.literal('not_declined'), assignment: assignmentSummarySchema }),
  /** Already in another of this mission's slots. */
  z.object({ constraint: z.literal('not_on_mission'), assignment: assignmentSummarySchema }),
]);
export type ConstraintFailureResponse = z.infer<typeof constraintFailureSchema>;

/** Why a crew member was lost to an unfilled slot: the first constraint they failed, or that they were needed elsewhere. */
export const LOSS_REASONS = [
  'active',
  'no_skill',
  'below_level',
  'certification',
  'availability',
  'free',
  'not_declined',
  'not_on_mission',
  'chosen_for_another_slot',
] as const;

const scoreSchema = z.object({
  /** From 0 to 1: the sum of the components' points. */
  total: z.number(),
  components: z.array(z.object({ name: matchWeightsSchema.keyof(), value: z.number(), weight: z.number(), points: z.number() })),
});

const slotResultSchema = z.object({
  slot: z.object({ skill: z.string(), min_level: z.number().int(), number: z.number().int(), headcount: z.number().int() }),
  chosen: z
    .object({
      crew_member: crewMemberSummarySchema,
      score: scoreSchema,
      /** Other drafts over the same period that propose this crew member; empty unless no clash-free crew existed. */
      clashes: z.array(missionSummarySchema),
    })
    .nullable(),
  /** Up to three other candidates, best first. */
  alternates: z.array(
    z.object({ crew_member: crewMemberSummarySchema, score: z.number(), chosen_for_another_slot: z.boolean(), clashes: z.array(missionSummarySchema) }),
  ),
  /** For a slot left unfilled: how many crew were lost to each reason, and the two nearest misses. */
  unfilled: z
    .object({
      lost_to: z.array(z.object({ reason: z.enum(LOSS_REASONS), count: z.number().int() })),
      nearest_misses: z.array(z.object({ crew_member: crewMemberSummarySchema, failures: z.array(constraintFailureSchema) })),
    })
    .nullable(),
});

/** What a match run proposes and why: the part the matcher works out, saved as it was. */
export const matchRunResultSchema = z.object({
  slots: z.array(slotResultSchema),
  /** Crew who hold the skill an open slot needs but cannot fill it, with why. */
  ruled_out: z.array(z.object({ crew_member: crewMemberSummarySchema, skill: z.string(), failures: z.array(constraintFailureSchema) })),
  summary: z.object({
    slots: z.number().int(),
    already_filled: z.number().int(),
    open: z.number().int(),
    filled: z.number().int(),
    clashes: z.number().int(),
  }),
});
export type MatchRunResult = z.infer<typeof matchRunResultSchema>;

export const matchRunSchema = matchRunResultSchema.extend({
  ref: z.string(),
  mission: z.string(),
  created_by: namedUserSchema,
  created_at: z.iso.datetime({ offset: true }),
  /** When the run was applied; a run applies once. */
  applied_at: z.iso.datetime({ offset: true }).nullable(),
  /** The organisation's weights when the run was made. */
  weights: matchWeightsSchema,
});
export type MatchRun = z.infer<typeof matchRunSchema>;

/** Applying a run that chose someone despite a clash says so: `allow_clashes` is the yes. */
export const applyMatchRunSchema = z.object({ allow_clashes: z.boolean().optional() }).strict();
export type ApplyMatchRun = z.infer<typeof applyMatchRunSchema>;
