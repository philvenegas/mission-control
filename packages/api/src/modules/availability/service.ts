import { type AvailabilityBlock, type CreateAvailabilityBlock, formatRef } from '@mission-control/contract';
import { reaches } from '../../auth/policy.ts';
import { refNumber, takeNextRef } from '../../db/refs.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { notFound } from '../../errors.ts';
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
