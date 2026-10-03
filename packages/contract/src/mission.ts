import { z } from 'zod';
import { ASSIGNMENT_STATUSES, MAX_LEVEL, MIN_LEVEL, MISSION_EVENT_TYPES, MISSION_STATUSES } from './domain.ts';
import { endsAfterStart, isoDaySchema, PERIOD_ORDER } from './period.ts';
import { nameSchema } from './text.ts';

/** Longest a mission's description may be. */
export const MAX_DESCRIPTION_LENGTH = 2000;
/** Longest a note on a transition may be. */
export const MAX_NOTE_LENGTH = 500;

const level = z.number().int().min(MIN_LEVEL).max(MAX_LEVEL);
const description = z.string().trim().max(MAX_DESCRIPTION_LENGTH);

/** A user, as a response names one: by name, and by email, which addresses them. */
export const namedUserSchema = z.object({ name: z.string(), email: z.string() });
export type NamedUser = z.infer<typeof namedUserSchema>;

/** What a mission needs of one skill. Each unit of headcount is one slot. */
export const requirementSchema = z.object({ skill: z.string(), min_level: level, headcount: z.number().int().min(1) });
export type Requirement = z.infer<typeof requirementSchema>;

/** A mission, as a director or a mission lead sees it. */
export const missionSchema = z.object({
  ref: z.string(),
  name: z.string(),
  description: z.string(),
  from: isoDaySchema,
  to: isoDaySchema,
  status: z.enum(MISSION_STATUSES),
  owner: namedUserSchema,
  /** Who submitted the current or latest submission; null before the first. */
  submitted_by: namedUserSchema.nullable(),
  requirements: z.array(requirementSchema),
  /**
   * How many approvals the organisation requires, and who has approved the current submission.
   * Nobody, while the mission is a draft: a rejection ends a submission and voids its approvals.
   */
  approval: z.object({ required: z.number().int(), approved_by: z.array(namedUserSchema) }),
});
export type Mission = z.infer<typeof missionSchema>;

/**
 * A mission as a crew member sees it: only one they are offered or accepted on, and only its name,
 * period and their own slot (DESIGN.md section 5).
 */
export const crewMissionSchema = z.object({
  ref: z.string(),
  name: z.string(),
  from: isoDaySchema,
  to: isoDaySchema,
  slot: z.object({ assignment: z.string(), skill: z.string(), status: z.enum(ASSIGNMENT_STATUSES) }),
});
export type CrewMission = z.infer<typeof crewMissionSchema>;

export const createMissionSchema = z
  .object({ name: nameSchema, description: description.optional(), from: isoDaySchema, to: isoDaySchema })
  .strict()
  .refine(endsAfterStart, PERIOD_ORDER);
export type CreateMission = z.infer<typeof createMissionSchema>;

/** A change to a draft. A new period gives both ends. */
export const updateMissionSchema = z
  .object({ name: nameSchema.optional(), description: description.optional(), from: isoDaySchema.optional(), to: isoDaySchema.optional() })
  .strict()
  .refine((update) => Object.keys(update).length > 0, { message: 'Give a name, a description or a period to change.' })
  .refine((update) => (update.from === undefined) === (update.to === undefined), {
    message: 'A new period gives both from and to.',
    path: ['to'],
  })
  .refine((update) => update.from === undefined || update.to === undefined || endsAfterStart({ from: update.from, to: update.to }), PERIOD_ORDER);
export type UpdateMission = z.infer<typeof updateMissionSchema>;

/** A requirement for one skill, set whole. Headcount defaults to one slot. */
export const setRequirementSchema = z.object({ min_level: level, headcount: z.number().int().min(1).optional() }).strict();
export type SetRequirement = z.infer<typeof setRequirementSchema>;

const note = z.string().trim().min(1).max(MAX_NOTE_LENGTH);

/** The body of a transition that needs a reason: reject and cancel. */
export const noteRequiredSchema = z.object({ note }).strict();
/** The body of any other transition: a note is welcome but optional. */
export const noteOptionalSchema = z.object({ note: note.optional() }).strict();
export type TransitionNote = z.infer<typeof noteOptionalSchema>;

/** One entry in a mission's history. */
export const missionEventSchema = z.object({
  type: z.enum(MISSION_EVENT_TYPES),
  from_status: z.enum(MISSION_STATUSES).nullable(),
  to_status: z.enum(MISSION_STATUSES).nullable(),
  actor: namedUserSchema,
  note: z.string().nullable(),
  at: z.iso.datetime({ offset: true }),
});
export type MissionEvent = z.infer<typeof missionEventSchema>;
