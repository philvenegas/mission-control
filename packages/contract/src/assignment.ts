import { z } from 'zod';
import { ASSIGNMENT_STATUSES } from './domain.ts';
import { isoDaySchema } from './period.ts';

/** Longest a crew member's reason for declining may be. */
export const MAX_DECLINE_REASON_LENGTH = 500;

/** A crew member, as an assignment or a match run names one. */
export const crewMemberSummarySchema = z.object({ ref: z.string(), name: z.string() });
export type CrewMemberSummary = z.infer<typeof crewMemberSummarySchema>;

/** Assigning a named crew member to an open slot of a mission's requirement for a skill, by hand. */
export const assignCrewSchema = z.object({ crew_member: z.string(), skill: z.string() }).strict();
export type AssignCrew = z.infer<typeof assignCrewSchema>;

/** A crew member declining an offered assignment, saying why if they wish. */
export const declineAssignmentSchema = z.object({ reason: z.string().trim().min(1).max(MAX_DECLINE_REASON_LENGTH).optional() }).strict();
export type DeclineAssignment = z.infer<typeof declineAssignmentSchema>;

/** One of a crew member's own assignments, as they see it: the mission's name and period, and their slot. */
export const crewAssignmentSchema = z.object({
  ref: z.string(),
  mission: z.object({ ref: z.string(), name: z.string(), from: isoDaySchema, to: isoDaySchema }),
  skill: z.string(),
  status: z.enum(ASSIGNMENT_STATUSES),
});
export type CrewAssignment = z.infer<typeof crewAssignmentSchema>;
