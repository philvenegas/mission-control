import { type AvailabilityBlock, type CreateAvailabilityBlock, formatRef, isLiveStatus, type Period, periodsOverlap } from '@mission-control/contract';
import { reaches } from '../../auth/policy.ts';
import { refNumber, takeNextRef } from '../../db/refs.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { DomainError, notFound } from '../../errors.ts';
import { listAssignmentsOfCrew } from '../assignments/repository.ts';
import { type CrewMemberRow, lockCrewMembers } from '../crew/repository.ts';
import { resolveCrewMember } from '../crew/service.ts';
import {
  type AvailabilityBlockRow,
  deleteAvailabilityBlock,
  findAvailabilityBlockByRef,
  getAvailabilityBlockByRef,
  insertAvailabilityBlock,
  listAvailabilityBlocks,
} from './repository.ts';

const toAvailabilityBlock = (row: AvailabilityBlockRow): AvailabilityBlock => ({
  ref: formatRef('availability_block', row.ref),
  crew_member: formatRef('crew_member', row.crewMemberRef),
  from: row.period.from,
  to: row.period.to,
  reason: row.reason,
});

/**
 * Refuses a block over one of the crew member's live assignments: they are committed for that
 * period. An offered or accepted one is named, since the crew member knows of it; a held one is not,
 * since they are not told of a mission still awaiting approval. A block over a proposal is accepted,
 * and the draft shows the problem.
 */
async function refuseOverAHold(context: TenantContext, crewMember: CrewMemberRow, period: Period) {
  const holding = (await listAssignmentsOfCrew(context, [crewMember.id])).filter(
    (assignment) => isLiveStatus(assignment.status) && periodsOverlap(assignment.period, period),
  );
  const who = `${crewMember.name} ${formatRef('crew_member', crewMember.ref)}`;
  const known = holding.find((assignment) => assignment.status !== 'held');
  if (known) {
    throw new DomainError(
      'CREW_HELD',
      `${who} is ${known.status} on ${formatRef('mission', known.mission.ref)} ${known.mission.name}, ${known.period.from} to ${known.period.to}.`,
      'Decline or release that assignment first.',
    );
  }
  if (holding.length > 0) throw new DomainError('CREW_HELD', `${who} is being planned for a mission in that period.`, 'Speak to their mission lead.');
}

export async function listAvailability(context: TenantContext, crewMemberRef: string): Promise<AvailabilityBlock[]> {
  const crewMember = await resolveCrewMember(context, crewMemberRef, 'crew:read');
  return (await listAvailabilityBlocks(context, crewMember.id)).map(toAvailabilityBlock);
}

export async function addAvailabilityBlock(
  context: TenantContext,
  crewMemberRef: string,
  input: CreateAvailabilityBlock,
): Promise<AvailabilityBlock> {
  const crewMember = await resolveCrewMember(context, crewMemberRef, 'availability:manage');
  await lockCrewMembers(context, [crewMember.id]);
  await refuseOverAHold(context, crewMember, { from: input.from, to: input.to });
  const ref = await takeNextRef(context, 'availability_block');
  await insertAvailabilityBlock(context, {
    ref,
    crewMemberId: crewMember.id,
    period: { from: input.from, to: input.to },
    reason: input.reason ?? null,
  });
  return toAvailabilityBlock(await getAvailabilityBlockByRef(context, ref));
}

/** Removes a block. One on another crew member's record, for a caller who may manage only their own, is not found. */
export async function removeAvailabilityBlock(context: TenantContext, blockRef: string): Promise<void> {
  const block = await findAvailabilityBlockByRef(context, refNumber('availability_block', blockRef));
  if (!block || !reaches(context, 'availability:manage', block.crewMemberUserId)) throw notFound(blockRef);
  await deleteAvailabilityBlock(context, block.id);
}
