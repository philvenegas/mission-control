import { z } from 'zod';
import { CREW_STATUSES, MAX_LEVEL, MIN_LEVEL } from './domain.ts';
import { endsAfterStart, isoDaySchema, PERIOD_ORDER } from './period.ts';
import { nameSchema as name } from './text.ts';

/** Longest an availability block's reason may be. */
export const MAX_REASON_LENGTH = 500;

export const skillSchema = z.object({ name: z.string(), category: z.string() });
export type Skill = z.infer<typeof skillSchema>;

export const crewSkillSchema = z.object({
  skill: z.string(),
  level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
  /** After this day the skill no longer counts. Null when it does not expire. */
  certified_until: isoDaySchema.nullable(),
});
export type CrewSkill = z.infer<typeof crewSkillSchema>;

export const crewMemberSchema = z.object({
  ref: z.string(),
  name: z.string(),
  status: z.enum(CREW_STATUSES),
  /** The email of the user this crew member logs in as; null when they have no login. */
  user_email: z.string().nullable(),
  skills: z.array(crewSkillSchema),
});
export type CrewMember = z.infer<typeof crewMemberSchema>;

export const createCrewMemberSchema = z.object({ name }).strict();
export type CreateCrewMember = z.infer<typeof createCrewMemberSchema>;

export const updateCrewMemberSchema = z
  .object({ name: name.optional(), status: z.enum(CREW_STATUSES).optional() })
  .strict()
  .refine((update) => update.name !== undefined || update.status !== undefined, { message: 'Give a name or a status to change.' });
export type UpdateCrewMember = z.infer<typeof updateCrewMemberSchema>;

export const setCrewSkillSchema = z
  .object({
    level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL),
    /** The day the skill stops counting. Leaving it out, or null, means it does not expire: a PUT replaces the whole skill. */
    certified_until: isoDaySchema.nullable().optional(),
  })
  .strict();
export type SetCrewSkill = z.infer<typeof setCrewSkillSchema>;

export const availabilityBlockSchema = z.object({
  ref: z.string(),
  crew_member: z.string(),
  from: isoDaySchema,
  to: isoDaySchema,
  reason: z.string().nullable(),
});
export type AvailabilityBlock = z.infer<typeof availabilityBlockSchema>;

export const createAvailabilityBlockSchema = z
  .object({ from: isoDaySchema, to: isoDaySchema, reason: z.string().trim().min(1).max(MAX_REASON_LENGTH).optional() })
  .strict()
  .refine(endsAfterStart, PERIOD_ORDER);
export type CreateAvailabilityBlock = z.infer<typeof createAvailabilityBlockSchema>;
