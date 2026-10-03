import { z } from 'zod';

export const ROLES = ['director', 'mission_lead', 'crew_member'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (value: unknown): value is Role => ROLES.some((role) => role === value);

export const CREW_STATUSES = ['active', 'inactive'] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];

/** In lifecycle order; `cancelled` can follow any status before `completed`. */
export const MISSION_STATUSES = ['draft', 'submitted', 'approved', 'active', 'completed', 'cancelled'] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const TRANSITIONS = ['submit', 'withdraw', 'approve', 'reject', 'launch', 'complete', 'cancel'] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** What a mission's history records: every transition, and a clash created by another mission's proposal. */
export const MISSION_EVENT_TYPES = [...TRANSITIONS, 'clash'] as const;
export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

export const ASSIGNMENT_STATUSES = ['proposed', 'held', 'offered', 'accepted', 'declined', 'released'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** A live assignment holds its crew member for its period. */
export const LIVE_ASSIGNMENT_STATUSES = ['held', 'offered', 'accepted'] as const satisfies readonly AssignmentStatus[];

/**
 * A crew member sees a mission once they are offered a place on it, and while they hold it. A held
 * assignment is not among these: they are not told of a mission that is still awaiting approval.
 */
export const CREW_VISIBLE_ASSIGNMENT_STATUSES = ['offered', 'accepted'] as const satisfies readonly AssignmentStatus[];

export const APPROVAL_DECISIONS = ['approve', 'reject'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

export const matchWeightsSchema = z.object({ proficiency: z.number(), workload: z.number(), rest: z.number() });
export type MatchWeights = z.infer<typeof matchWeightsSchema>;

export const orgSettingsSchema = z.object({
  approvals_required: z.number().int().min(1),
  allow_unfilled_submission: z.boolean(),
  /** Designed, not built. */
  min_rest_days: z.number().int().min(0),
  match_weights: matchWeightsSchema,
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = { proficiency: 0.45, workload: 0.35, rest: 0.2 };

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  approvals_required: 1,
  allow_unfilled_submission: false,
  min_rest_days: 0,
  match_weights: DEFAULT_MATCH_WEIGHTS,
};
