import type { MatchRunResult, MatchWeights } from '@mission-control/contract';
import { and, eq, sql } from 'drizzle-orm';
import { matchRuns, missions, users } from '../../db/schema.ts';
import type { TenantContext } from '../../db/tenant.ts';

/** A new match run made by the caller: what the matcher proposed and why, with the weights in force. */
export async function insertMatchRun(
  { tx, orgId, userId }: TenantContext,
  values: { ref: number; missionId: string; result: MatchRunResult; weights: MatchWeights },
) {
  await tx.insert(matchRuns).values({ orgId, createdBy: userId, ...values });
}

/** A match run, with its mission and who made it. Its result is as saved, to be read through its schema. */
export async function findMatchRunByRef({ tx, orgId }: TenantContext, ref: number) {
  const [run] = await tx
    .select({
      id: matchRuns.id,
      ref: matchRuns.ref,
      missionRef: missions.ref,
      missionOwnerId: missions.ownerId,
      createdBy: { name: users.name, email: users.email },
      result: matchRuns.result,
      weights: matchRuns.weights,
      appliedAt: matchRuns.appliedAt,
      createdAt: matchRuns.createdAt,
    })
    .from(matchRuns)
    .innerJoin(missions, and(eq(missions.orgId, matchRuns.orgId), eq(missions.id, matchRuns.missionId)))
    .innerJoin(users, and(eq(users.orgId, matchRuns.orgId), eq(users.id, matchRuns.createdBy)))
    .where(and(eq(matchRuns.orgId, orgId), eq(matchRuns.ref, ref)));
  return run;
}

export type MatchRunRow = NonNullable<Awaited<ReturnType<typeof findMatchRunByRef>>>;

/** Marks a run applied. The caller holds its mission's row lock, so no other request is applying it. */
export async function markApplied({ tx, orgId }: TenantContext, id: string) {
  await tx.update(matchRuns).set({ appliedAt: sql`now()` }).where(and(eq(matchRuns.orgId, orgId), eq(matchRuns.id, id)));
}
