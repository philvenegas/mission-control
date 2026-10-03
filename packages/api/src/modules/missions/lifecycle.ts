import { type AssignmentStatus, formatRef, LIVE_ASSIGNMENT_STATUSES, type MissionStatus, type Transition } from '@mission-control/contract';
import type { Permission } from '../../auth/policy.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { DomainError } from '../../errors.ts';
import { getOrganisation } from '../org/repository.ts';
import { approvalState } from './approval.ts';
import {
  countAssignmentsByRequirement,
  countDirectorsOtherThan,
  insertDecision,
  listCurrentDecisions,
  listRequirements,
  type MissionRow,
  moveAssignments,
  startSubmission,
} from './repository.ts';

/** One transition in progress: who is making it, on which mission, with what note. */
interface TransitionRun {
  context: TenantContext;
  mission: MissionRow;
  note: string | null;
}

/**
 * One row of the transition table (DESIGN.md section 4): from which statuses a transition may be
 * made, to which status it leads, which permission it needs, what must hold, and what it does.
 */
export interface TransitionRule {
  transition: Transition;
  from: readonly MissionStatus[];
  to: MissionStatus;
  permission: Permission;
  /** Whether the transition needs a note saying why. */
  needsNote: boolean;
  /** Throws when the transition may not be made. */
  guard?: (run: TransitionRun) => Promise<void>;
  /**
   * Records what the transition decides before the status changes. Returns false when the mission
   * should stay where it is, as a submission does until enough directors have approved it.
   */
  decide?: (run: TransitionRun) => Promise<boolean>;
  /** Changes the mission's assignments, once its status has changed. */
  effect?: (run: TransitionRun) => Promise<void>;
}

const ref = (mission: MissionRow) => formatRef('mission', mission.ref);

const guardFailed = (message: string, hint?: string) => new DomainError('GUARD_FAILED', message, hint);

const moveCrew = (from: readonly AssignmentStatus[], to: AssignmentStatus) => async ({ context, mission }: TransitionRun) =>
  moveAssignments(context, mission.id, from, to);

/** Whoever submitted a mission cannot decide on it, whatever their role. */
const notTheSubmitter = (verb: 'approve' | 'reject') => async ({ context, mission }: TransitionRun) => {
  if (mission.submittedById === context.userId) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', `You submitted ${ref(mission)}, so you cannot ${verb} it.`, `Ask another director to ${verb} it.`);
  }
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** The day, as `2027-03-01`, in UTC. */
const today = () => new Date().toISOString().slice(0, 10);

async function submitGuard({ context, mission }: TransitionRun) {
  const refusal = (reason: string) => guardFailed(`${ref(mission)} cannot be submitted: ${reason}.`);
  if ((await listRequirements(context, [mission.id])).length === 0) {
    throw refusal('it has no requirements');
  }
  if (mission.period.from <= today()) {
    throw refusal(`it starts on ${mission.period.from}, which is not in the future`);
  }
  const { name, settings } = await getOrganisation(context);
  const directors = await countDirectorsOtherThan(context, context.userId);
  if (directors < settings.approvals_required) {
    throw refusal(
      `${name} requires ${plural(settings.approvals_required, 'approval')}, but only ${plural(directors, 'director')} other than you can approve`,
    );
  }
}

/** Approves the current submission for the caller, and says whether the approval policy is now met. */
async function recordApproval({ context, mission, note }: TransitionRun) {
  const decisions = await listCurrentDecisions(context, [mission.id]);
  if (decisions.some((decision) => decision.approverId === context.userId)) {
    throw guardFailed(`You have already approved ${ref(mission)}.`);
  }
  await insertDecision(context, { missionId: mission.id, submissionNo: mission.submissionNo, decision: 'approve', note });
  const { settings } = await getOrganisation(context);
  return approvalState(settings, [...decisions, { approverId: context.userId, decision: 'approve' }]) === 'approved';
}

/** Rejects the current submission, which ends it: its approvals no longer count. */
async function recordRejection({ context, mission, note }: TransitionRun) {
  await insertDecision(context, { missionId: mission.id, submissionNo: mission.submissionNo, decision: 'reject', note });
  return true;
}

async function everySlotAccepted({ context, mission }: TransitionRun) {
  const requirements = await countAssignmentsByRequirement(context, mission.id, 'accepted');
  const short = requirements.filter((requirement) => requirement.crew < requirement.headcount);
  if (short.length > 0) {
    const fill = short.map((requirement) => `${requirement.skill} ${requirement.crew} of ${requirement.headcount}`).join(', ');
    throw guardFailed(`${ref(mission)} cannot be launched until every slot is accepted: ${fill}.`);
  }
}

/** The assignments a cancellation releases: proposals, and every hold. */
const RELEASED_ON_CANCEL = ['proposed', ...LIVE_ASSIGNMENT_STATUSES] as const;

/** The whole lifecycle. A transition not listed here, or from a status not listed, cannot happen. */
export const TRANSITION_TABLE: readonly TransitionRule[] = [
  {
    transition: 'submit',
    from: ['draft'],
    to: 'submitted',
    permission: 'missions:submit',
    needsNote: false,
    guard: submitGuard,
    effect: async (run) => {
      await startSubmission(run.context, run.mission.id);
      await moveCrew(['proposed'], 'held')(run);
    },
  },
  {
    transition: 'approve',
    from: ['submitted'],
    to: 'approved',
    permission: 'missions:approve',
    needsNote: false,
    guard: notTheSubmitter('approve'),
    decide: recordApproval,
    effect: moveCrew(['held'], 'offered'),
  },
  {
    transition: 'reject',
    from: ['submitted'],
    to: 'draft',
    permission: 'missions:reject',
    needsNote: true,
    guard: notTheSubmitter('reject'),
    decide: recordRejection,
    effect: moveCrew(['held'], 'proposed'),
  },
  {
    transition: 'launch',
    from: ['approved'],
    to: 'active',
    permission: 'missions:launch',
    needsNote: false,
    guard: everySlotAccepted,
  },
  {
    transition: 'complete',
    from: ['active'],
    to: 'completed',
    permission: 'missions:complete',
    needsNote: false,
  },
  {
    transition: 'cancel',
    from: ['draft', 'submitted', 'approved'],
    to: 'cancelled',
    permission: 'missions:cancel',
    needsNote: true,
    effect: moveCrew(RELEASED_ON_CANCEL, 'released'),
  },
  {
    transition: 'cancel',
    from: ['active'],
    to: 'cancelled',
    permission: 'missions:cancel-active',
    needsNote: true,
    effect: moveCrew(RELEASED_ON_CANCEL, 'released'),
  },
];
