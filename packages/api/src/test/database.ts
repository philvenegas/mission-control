import { connect } from '../db/connection.ts';
import { exactlyOne } from '../db/rows.ts';
import { requireEnv } from '../env.ts';

/** The test database as its owner: for seeding and for checking what the database itself enforces. */
export const connectAsOwner = () => connect(requireEnv('TEST_DATABASE_OWNER_URL'));

/** The test database as the API's role. */
export const connectAsApi = () => connect(requireEnv('TEST_DATABASE_URL'));

/** The one row a query returns. The test fails, naming `what`, if it returns none or several. */
export const onlyRow = async <Row>(query: PromiseLike<readonly Row[]>, what: string): Promise<Row> =>
  exactlyOne(await query, what);

/** The Postgres error code of a failed query, or null if it did not fail. */
export async function errorCode(query: PromiseLike<unknown>): Promise<string | null> {
  try {
    await query;
    return null;
  } catch (error) {
    let current: unknown = error;
    while (current && typeof current === 'object') {
      if ('code' in current && typeof current.code === 'string') return current.code;
      current = 'cause' in current ? current.cause : null;
    }
    throw error;
  }
}

export const FOREIGN_KEY_VIOLATION = '23503';
export const EXCLUSION_VIOLATION = '23P01';
export const CHECK_VIOLATION = '23514';
export const INSUFFICIENT_PRIVILEGE = '42501';
