import { parseRef, type RefKind } from '@mission-control/contract';
import type { connectAsOwner } from './database.ts';

// Testing a row lock. Two requests raced against each other rarely land in the window a lock
// protects, so such a test passes with the lock or without it. Holding the lock from the test, and
// asserting the request waits on it, fails the moment the lock is removed.

type OwnerClient = ReturnType<typeof connectAsOwner>['client'];

const TABLES: Record<RefKind, string> = {
  mission: 'missions',
  crew_member: 'crew_members',
  assignment: 'assignments',
  match_run: 'match_runs',
  availability_block: 'availability_blocks',
};

/** A record whose row the test locks: its organisation's slug, its kind and its reference. */
export interface RecordToLock {
  org: string;
  kind: RefKind;
  ref: string;
}

/**
 * Sends a request while the test holds a record's row lock, and says whether the request waited on a
 * lock, and how it was answered once the test let go. A request that takes the same lock waits; one
 * that does not finishes while the lock is still held.
 */
export async function waitsForRowLock(owner: OwnerClient, record: RecordToLock, request: () => Response | Promise<Response>) {
  const { inFlight, waited } = await owner.begin(async (tx) => {
    const rows = await tx`
      SELECT 1 FROM ${tx(TABLES[record.kind])}
      WHERE ref = ${parseRef(record.kind, record.ref)} AND org_id = (SELECT id FROM organisations WHERE slug = ${record.org})
      FOR UPDATE`;
    if (rows.length !== 1) throw new Error(`There is no ${record.kind} ${record.ref} in ${record.org} to lock`);
    let settled = false;
    const sent = Promise.resolve(request()).finally(() => (settled = true));
    let blocked = false;
    for (let attempt = 0; attempt < 100 && !blocked && !settled; attempt++) {
      // pg_locks, not pg_stat_activity: the owner may not read another role's wait events.
      const [waiting] = await owner`SELECT count(*)::int AS requests FROM pg_locks WHERE NOT granted`;
      blocked = (waiting?.requests ?? 0) > 0;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Wrapped, so the transaction ends, letting the request go on, before it is awaited.
    return { inFlight: sent, waited: blocked };
  });
  return { waited, status: (await inFlight).status };
}
