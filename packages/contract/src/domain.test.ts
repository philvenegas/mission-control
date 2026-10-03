import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_STATUSES,
  CREW_VISIBLE_ASSIGNMENT_STATUSES,
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_ORG_SETTINGS,
  LIVE_ASSIGNMENT_STATUSES,
  matchWeightsSchema,
  MISSION_EVENT_TYPES,
  TRANSITIONS,
} from './domain.ts';

describe('the shared domain values', () => {
  it('counts held, offered and accepted assignments as live, and no others', () => {
    expect(LIVE_ASSIGNMENT_STATUSES).toEqual(['held', 'offered', 'accepted']);
    const live: readonly string[] = LIVE_ASSIGNMENT_STATUSES;
    expect(ASSIGNMENT_STATUSES.filter((status) => !live.includes(status))).toEqual([
      'proposed',
      'declined',
      'released',
    ]);
  });

  it('shows a crew member a mission once they are offered a place, never while they are only held', () => {
    expect(CREW_VISIBLE_ASSIGNMENT_STATUSES).toEqual(['offered', 'accepted']);
  });

  it('takes match weights as shares: none negative, and not all zero', () => {
    expect(matchWeightsSchema.safeParse(DEFAULT_MATCH_WEIGHTS).success).toBe(true);
    expect(matchWeightsSchema.safeParse({ proficiency: 2, workload: 1, rest: 0 }).success).toBe(true);
    expect(matchWeightsSchema.safeParse({ proficiency: 1, workload: -0.5, rest: 0.5 }).success).toBe(false);
    expect(matchWeightsSchema.safeParse({ proficiency: 0, workload: 0, rest: 0 }).success).toBe(false);
  });

  it('records every transition in a mission\'s history, plus a clash', () => {
    expect(MISSION_EVENT_TYPES).toEqual([...TRANSITIONS, 'clash']);
  });

  it('defaults to one approval, strict submission and match weights that sum to one', () => {
    expect(DEFAULT_ORG_SETTINGS).toMatchObject({ approvals_required: 1, allow_unfilled_submission: false, min_rest_days: 0 });
    const { proficiency, workload, rest } = DEFAULT_MATCH_WEIGHTS;
    expect(proficiency + workload + rest).toBeCloseTo(1);
  });
});
