import { type AvailabilityBlock, type CreateAvailabilityBlock, formatRef } from '@mission-control/contract';
import { scopeOf } from '../../auth/policy.ts';
import { exactlyOne } from '../../db/rows.ts';
import { refNumber, takeNextRef } from '../../db/refs.ts';
import type { TenantContext } from '../../db/tenant.ts';
import { forbidden, notFound } from '../../errors.ts';
import { resolveCrewMember } from '../crew/service.ts';
import {
  type AvailabilityBlockRow,
  deleteAvailabilityBlock,
  findAvailabilityBlockByRef,
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

export async function listAvailability(context: TenantContext, crewMemberText: string): Promise<AvailabilityBlock[]> {
  const crewMember = await resolveCrewMember(context, crewMemberText, 'crew:read');
  return (await listAvailabilityBlocks(context, crewMember.id)).map(toAvailabilityBlock);
}

export async function addAvailabilityBlock(
  context: TenantContext,
  crewMemberText: string,
  input: CreateAvailabilityBlock,
): Promise<AvailabilityBlock> {
  const crewMember = await resolveCrewMember(context, crewMemberText, 'availability:manage');
  const ref = await takeNextRef(context, 'availability_block');
  await insertAvailabilityBlock(context, {
    ref,
    crewMemberId: crewMember.id,
    period: { from: input.from, to: input.to },
    reason: input.reason ?? null,
  });
  const block = await findAvailabilityBlockByRef(context, ref);
  return toAvailabilityBlock(exactlyOne(block ? [block] : [], 'availability block'));
}

/** Removes a block. One on another crew member's record, for a caller who may manage only their own, is not found. */
export async function removeAvailabilityBlock(context: TenantContext, text: string): Promise<void> {
  const scope = scopeOf(context.role, 'availability:manage');
  if (!scope) throw forbidden('Your role does not allow this.');
  const block = await findAvailabilityBlockByRef(context, refNumber('availability_block', text));
  if (!block || (scope === 'own' && block.crewMemberUserId !== context.userId)) throw notFound(text);
  await deleteAvailabilityBlock(context, block.id);
}
