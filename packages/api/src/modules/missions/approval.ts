import type { ApprovalDecision, OrgSettings } from '@mission-control/contract';

/** An organisation's rule for when a submission counts as approved (DESIGN.md section 4). */
export type ApprovalPolicy = Pick<OrgSettings, 'approvals_required'>;

/** One director's decision on the current submission. */
export interface ApprovalDecisionRecord {
  approverId: string;
  decision: ApprovalDecision;
}

/**
 * Whether a submission is approved: enough distinct directors have approved it. A rejection ends
 * the submission, so a submission with one is never approved.
 */
export function approvalState(policy: ApprovalPolicy, decisions: readonly ApprovalDecisionRecord[]): 'pending' | 'approved' {
  if (decisions.some((record) => record.decision === 'reject')) return 'pending';
  const approvers = new Set(decisions.map((record) => record.approverId));
  return approvers.size >= policy.approvals_required ? 'approved' : 'pending';
}
