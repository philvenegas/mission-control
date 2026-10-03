import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_STATUSES,
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_ORG_SETTINGS,
  LIVE_ASSIGNMENT_STATUSES,
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

  it('records every transition in a mission\'s history, plus a clash', () => {
    expect(MISSION_EVENT_TYPES).toEqual([...TRANSITIONS, 'clash']);
  });

  it('defaults to one approval, strict submission and match weights that sum to one', () => {
    expect(DEFAULT_ORG_SETTINGS).toMatchObject({ approvals_required: 1, allow_unfilled_submission: false, min_rest_days: 0 });
    const { proficiency, workload, rest } = DEFAULT_MATCH_WEIGHTS;
    expect(proficiency + workload + rest).toBeCloseTo(1);
  });
});
