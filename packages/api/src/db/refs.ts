import { parseRef, type RefKind } from '@mission-control/contract';
import { eq, sql } from 'drizzle-orm';
import { notFound } from '../errors.ts';
import { exactlyOne } from './rows.ts';
import { organisations } from './schema.ts';
import type { TenantContext } from './tenant.ts';

const COUNTERS = {
  mission: 'lastMissionRef',
  crew_member: 'lastCrewMemberRef',
  assignment: 'lastAssignmentRef',
  match_run: 'lastMatchRunRef',
  availability_block: 'lastAvailabilityBlockRef',
} as const satisfies Record<RefKind, keyof typeof organisations.$inferSelect>;

/**
 * The next reference number of a kind, taken inside the creating transaction. The update locks the
 * organisation's row, so two requests creating at once get different numbers.
 */
export async function takeNextRef({ tx, orgId }: TenantContext, kind: RefKind): Promise<number> {
  const counter = organisations[COUNTERS[kind]];
  const rows = await tx
    .update(organisations)
    .set({ [COUNTERS[kind]]: sql`${counter} + 1` })
    .where(eq(organisations.id, orgId))
    .returning({ number: counter });
  return exactlyOne(rows, 'organisation').number;
}

/** The number in a reference a caller gave. Text that is not a reference of the kind names nothing, so it is not found. */
export function refNumber(kind: RefKind, text: string): number {
  const number = parseRef(kind, text);
  if (number === null) throw notFound(text);
  return number;
}
