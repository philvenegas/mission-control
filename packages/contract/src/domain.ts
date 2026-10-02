export const ROLES = ['director', 'mission_lead', 'crew_member'] as const;
export type Role = (typeof ROLES)[number];

export const CREW_STATUSES = ['active', 'inactive'] as const;
export type CrewStatus = (typeof CREW_STATUSES)[number];

export const MISSION_STATUSES = ['draft', 'submitted', 'approved', 'active', 'completed', 'cancelled'] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const ASSIGNMENT_STATUSES = ['proposed', 'held', 'offered', 'accepted', 'declined', 'released'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** A live assignment holds its crew member for its period. */
export const LIVE_ASSIGNMENT_STATUSES = ['held', 'offered', 'accepted'] as const satisfies readonly AssignmentStatus[];

export const APPROVAL_DECISIONS = ['approve', 'reject'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

export interface MatchWeights {
  proficiency: number;
  workload: number;
  rest: number;
}

export interface OrgSettings {
  approvals_required: number;
  allow_unfilled_submission: boolean;
  /** Designed, not built. */
  min_rest_days: number;
  match_weights: MatchWeights;
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = { proficiency: 0.45, workload: 0.35, rest: 0.2 };
