import {
  type AssignmentStatus,
  formatRef,
  type MissionStatus,
  PLACED_ASSIGNMENT_STATUSES,
  ROLES,
  type Transition,
} from '@mission-control/contract';
import { can, type Permission, reaches } from '../../auth/policy.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { DomainError, forbidden } from '../../errors.ts';
import { listMissionCrew } from '../assignments/repository.ts';
import { lockCrewMembers } from '../crew/repository.ts';
import { currentRequirements } from '../matching/candidates.ts';
import { checkProposals, describeProblems } from './proposals.ts';
import { getOrganisation } from '../org/repository.ts';
import { approvalState } from './approval.ts';
import {
  countAssignmentsByRequirement,
  countDirectorsOtherThan,
  getMissionByRef,
  insertDecision,
  insertEvent,
  listCurrentDecisions,
  listRequirements,
  lockMission,
  type MissionRow,
  moveAssignments,
  moveMission,
  startSubmission,
} from './repository.ts';

// The mission lifecycle (DESIGN.md section 4): the transition table, and the one function that
// makes a transition by it. Every status change goes through here.

/** One transition in progress: who is making it, on which mission, with what note. */
interface TransitionRun {
  context: TenantContext;
  mission: MissionRow;
  note: string | null;
}

/**
 * One row of the transition table: from which statuses a transition may be made, to which status
 * it leads, which permission it needs, what must hold, and what it does.
 */
interface TransitionRule {
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

const missionRef = (mission: MissionRow) => formatRef('mission', mission.ref);

const guardFailed = (message: string, hint?: string) => new DomainError('GUARD_FAILED', message, hint);

const moveCrew = (from: readonly AssignmentStatus[], to: AssignmentStatus) => async ({ context, mission }: TransitionRun) =>
  moveAssignments(context, mission.id, from, to);

/** Whoever submitted a mission cannot decide on it, whatever their role. */
const notTheSubmitter = (verb: 'approve' | 'reject') => async ({ context, mission }: TransitionRun) => {
  if (mission.submittedById === context.userId) {
    throw new DomainError(
      'SELF_APPROVAL_FORBIDDEN',
      `You submitted ${missionRef(mission)}, so you cannot ${verb} it.`,
      `Ask another director to ${verb} it.`,
    );
  }
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** The day, as `2027-03-01`, in UTC. */
const today = () => new Date().toISOString().slice(0, 10);

async function submitGuard({ context, mission }: TransitionRun) {
  if ((await listRequirements(context, [mission.id])).length === 0) {
    throw guardFailed(`${missionRef(mission)} cannot be submitted: it has no requirements.`);
  }
  if (mission.period.from <= today()) {
    throw guardFailed(`${missionRef(mission)} cannot be submitted: it starts on ${mission.period.from}, which is not in the future.`);
  }
  const { name, settings } = await getOrganisation(context);
  const directors = await countDirectorsOtherThan(context, context.userId);
  if (directors < settings.approvals_required) {
    // The design's own words (section 4): a mission never waits on an approval that cannot come.
    throw guardFailed(
      `${name} requires ${plural(settings.approvals_required, 'approval')}, but only ${plural(directors, 'director')} other than you can approve.`,
    );
  }
  // Submitted means sound: every proposal passes the proposal check.
  const [requirements, missionCrew] = await Promise.all([listRequirements(context, [mission.id]), listMissionCrew(context, [mission.id])]);
  // What the check rests on cannot change under it: an availability block, a skill, a status.
  await lockCrewMembers(context, missionCrew.map(({ crewMemberId }) => crewMemberId));
  const problems = describeProblems(await checkProposals(context, { missions: [mission], requirements, missionCrew, weights: settings.match_weights }));
  if (problems.length > 0) {
    throw guardFailed(
      `${missionRef(mission)} cannot be submitted: ${problems.join('; ')}.`,
      'Each problem must be resolved first: release the crew member, or change what blocks them.',
    );
  }
  const unfilled = (await currentRequirements(context, mission)).filter(({ filled, headcount }) => filled < headcount);
  if (unfilled.length > 0 && !settings.allow_unfilled_submission) {
    const fillCounts = unfilled.map(({ skill, filled, headcount }) => `${skill} has ${filled} of ${headcount} slots filled`).join('; ');
    throw guardFailed(`${missionRef(mission)} cannot be submitted: ${fillCounts}.`, `${name} does not allow a mission to be submitted with open slots.`);
  }
}

/** Starts a new submission made by the caller, and holds the crew the draft proposed. */
async function startSubmissionAndHold(run: TransitionRun) {
  await startSubmission(run.context, run.mission.id);
  await moveCrew(['proposed'], 'held')(run);
}

/** Approves the current submission for the caller, and says whether the approval policy is now met. */
async function recordApproval({ context, mission, note }: TransitionRun) {
  const decisions = await listCurrentDecisions(context, [mission.id]);
  if (decisions.some((decision) => decision.approverId === context.userId)) {
    throw guardFailed(`You have already approved ${missionRef(mission)}.`);
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
  const unfilled = requirements.filter((requirement) => requirement.crew < requirement.headcount);
  if (unfilled.length > 0) {
    const fillCounts = unfilled.map((requirement) => `${requirement.skill} ${requirement.crew} of ${requirement.headcount}`).join(', ');
    throw guardFailed(`${missionRef(mission)} cannot be launched until every slot is accepted: ${fillCounts}.`);
  }
}

/** Cancelling releases proposals and every hold, whoever cancels and from whichever status. */
const CANCEL = {
  transition: 'cancel',
  to: 'cancelled',
  needsNote: true,
  effect: moveCrew(PLACED_ASSIGNMENT_STATUSES, 'released'),
} as const;

/** The whole lifecycle. A transition not listed here, or from a status not listed, cannot happen. */
const TRANSITION_TABLE: readonly TransitionRule[] = [
  {
    transition: 'submit',
    from: ['draft'],
    to: 'submitted',
    permission: 'missions:submit',
    needsNote: false,
    guard: submitGuard,
    effect: startSubmissionAndHold,
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
  { ...CANCEL, from: ['draft', 'submitted', 'approved'], permission: 'missions:cancel' },
  { ...CANCEL, from: ['active'], permission: 'missions:cancel-active' },
];

/** The transitions the table holds. `withdraw` is designed, not built, so it is not among them. */
export const BUILT_TRANSITIONS: readonly Transition[] = [...new Set(TRANSITION_TABLE.map((rule) => rule.transition))];

/** Whether a transition needs a note saying why. */
export const needsNote = (transition: Transition) => TRANSITION_TABLE.some((rule) => rule.transition === transition && rule.needsNote);

/**
 * The permission a transition's route declares: of the permissions its rows need, the one held by
 * every role that holds any of them, so the route lets through everyone who may make it from some
 * status, and its row decides the rest.
 */
export function routePermission(transition: Transition): Permission {
  const permissions = TRANSITION_TABLE.filter((rule) => rule.transition === transition).map((rule) => rule.permission);
  const widest = permissions.find((candidate) =>
    ROLES.every((role) => !permissions.some((permission) => can(role, permission)) || can(role, candidate)),
  );
  if (!widest) throw new Error(`No one permission covers every role that may ${transition}`);
  return widest;
}

/** How a refusal names a transition once made: "it cannot be submitted". */
const PAST_PARTICIPLE: Record<Transition, string> = {
  submit: 'submitted',
  withdraw: 'withdrawn',
  approve: 'approved',
  reject: 'rejected',
  launch: 'launched',
  complete: 'completed',
  cancel: 'cancelled',
};

const transitionNotAllowed = (mission: MissionRow, transition: Transition) =>
  new DomainError('TRANSITION_NOT_ALLOWED', `${missionRef(mission)} is ${mission.status}, so it cannot be ${PAST_PARTICIPLE[transition]}.`);

/**
 * Makes a transition on a mission the caller can see, as the table says: from the statuses it
 * allows, by those it permits, when its guard holds. The status changes only if it is still the one
 * the guard saw, and the event is written in the same transaction.
 */
export async function runTransition(context: TenantContext, visible: MissionRow, transition: Transition, note: string | null) {
  // One transition on a mission at a time: a second waits, then reads what the first did.
  await lockMission(context, visible.id);
  const mission = await getMissionByRef(context, visible.ref);

  const rule = TRANSITION_TABLE.find((candidate) => candidate.transition === transition && candidate.from.includes(mission.status));
  if (!rule) throw transitionNotAllowed(mission, transition);
  if (!reaches(context, rule.permission, mission.ownerId)) {
    throw forbidden(
      can(context.role, rule.permission)
        ? `Only ${missionRef(mission)}'s owner or a director can ${transition} it.`
        : `Only a director can ${transition} ${missionRef(mission)} now that it is ${mission.status}.`,
    );
  }

  const run = { context, mission, note };
  await rule.guard?.(run);
  const statusChanges = rule.decide ? await rule.decide(run) : true;
  if (statusChanges) {
    if (!(await moveMission(context, mission.id, mission.status, rule.to))) throw transitionNotAllowed(mission, transition);
    await rule.effect?.(run);
  }
  await insertEvent(context, {
    missionId: mission.id,
    type: transition,
    fromStatus: mission.status,
    toStatus: statusChanges ? rule.to : mission.status,
    note,
  });
}
