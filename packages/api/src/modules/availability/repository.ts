import type { Period } from '@mission-control/contract';
import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { availabilityBlocks, crewMembers } from '../../db/schema.ts';
import { exactlyOne } from '../../db/rows.ts';
import type { TenantContext } from '../../db/tenant.ts';

function selectBlocks({ tx, orgId }: TenantContext, condition: SQL) {
  return tx
    .select({
      id: availabilityBlocks.id,
      ref: availabilityBlocks.ref,
      period: availabilityBlocks.period,
      reason: availabilityBlocks.reason,
      crewMemberId: availabilityBlocks.crewMemberId,
      crewMemberRef: crewMembers.ref,
      crewMemberUserId: crewMembers.userId,
    })
    .from(availabilityBlocks)
    .innerJoin(crewMembers, and(eq(crewMembers.orgId, availabilityBlocks.orgId), eq(crewMembers.id, availabilityBlocks.crewMemberId)))
    .where(and(eq(availabilityBlocks.orgId, orgId), condition));
}

export type AvailabilityBlockRow = Awaited<ReturnType<typeof selectBlocks>>[number];

/** The availability blocks of each of the given crew members, earliest first. */
export function listAvailabilityBlocksOf(context: TenantContext, crewMemberIds: string[]): Promise<AvailabilityBlockRow[]> {
  return selectBlocks(context, inArray(availabilityBlocks.crewMemberId, crewMemberIds)).orderBy(
    sql`lower(${availabilityBlocks.period})`,
    asc(availabilityBlocks.ref),
  );
}

/** A crew member's availability blocks, earliest first. */
export const listAvailabilityBlocks = (context: TenantContext, crewMemberId: string) => listAvailabilityBlocksOf(context, [crewMemberId]);

export async function findAvailabilityBlockByRef(context: TenantContext, ref: number): Promise<AvailabilityBlockRow | undefined> {
  const [block] = await selectBlocks(context, eq(availabilityBlocks.ref, ref));
  return block;
}

/** A block that must exist, such as one just created. */
export async function getAvailabilityBlockByRef(context: TenantContext, ref: number): Promise<AvailabilityBlockRow> {
  return exactlyOne(await selectBlocks(context, eq(availabilityBlocks.ref, ref)), 'availability block');
}

export async function insertAvailabilityBlock(
  { tx, orgId }: TenantContext,
  values: { ref: number; crewMemberId: string; period: Period; reason: string | null },
) {
  await tx.insert(availabilityBlocks).values({ orgId, ...values });
}

export async function deleteAvailabilityBlock({ tx, orgId }: TenantContext, id: string) {
  await tx.delete(availabilityBlocks).where(and(eq(availabilityBlocks.orgId, orgId), eq(availabilityBlocks.id, id)));
}
