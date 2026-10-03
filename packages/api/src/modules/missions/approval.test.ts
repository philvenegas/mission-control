import { describe, expect, it } from 'vitest';
import { approvalState } from './approval.ts';

const approve = (approverId: string) => ({ approverId, decision: 'approve' as const });

describe('whether a submission is approved', () => {
  it('is approved once as many directors as the policy requires have approved', () => {
    expect(approvalState({ approvals_required: 1 }, [approve('dana')])).toBe('approved');
    expect(approvalState({ approvals_required: 2 }, [approve('ines'), approve('tomas')])).toBe('approved');
  });

  it('is pending with fewer approvals than the policy requires, or none', () => {
    expect(approvalState({ approvals_required: 1 }, [])).toBe('pending');
    expect(approvalState({ approvals_required: 2 }, [approve('ines')])).toBe('pending');
  });

  it('counts a director once, however many times their approval appears', () => {
    expect(approvalState({ approvals_required: 2 }, [approve('ines'), approve('ines')])).toBe('pending');
  });

  it('is never approved once a director has rejected the submission', () => {
    expect(
      approvalState({ approvals_required: 2 }, [approve('ines'), approve('tomas'), { approverId: 'yuki', decision: 'reject' }]),
    ).toBe('pending');
  });
});
