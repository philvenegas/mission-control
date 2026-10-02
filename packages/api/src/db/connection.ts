import type { PgDatabase } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

/** A database handle or a transaction on one; both run queries the same way. */
export type Database = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

export function connect(url: string) {
  const client = postgres(url, { onnotice: () => {} });
  return { client, db: drizzle(client, { schema }) };
}

export interface DatabaseAddress {
  role: string;
  password: string;
  database: string;
}

/**
 * The role and database a connection address names. Both are checked to be plain identifiers,
 * because roles and databases cannot be query parameters and so are written into SQL as text.
 */
export function parseDatabaseUrl(url: string): DatabaseAddress {
  const parsed = new URL(url);
  const role = decodeURIComponent(parsed.username);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  for (const name of [role, database]) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`"${name}" in the database address is not a plain identifier`);
  }
  return { role, password: decodeURIComponent(parsed.password), database };
}
