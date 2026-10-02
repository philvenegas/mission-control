import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export function connect(url: string) {
  const client = postgres(url, { onnotice: () => {} });
  return { client, db: drizzle(client, { schema }) };
}

export type Database = ReturnType<typeof connect>['db'];

/** The role and database a connection address names, checked to be plain identifiers. */
export function parseDatabaseUrl(url: string): { role: string; password: string; database: string } {
  const parsed = new URL(url);
  const role = decodeURIComponent(parsed.username);
  const database = parsed.pathname.slice(1);
  for (const name of [role, database]) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`"${name}" in ${parsed.host}${parsed.pathname} is not a plain identifier`);
  }
  return { role, password: decodeURIComponent(parsed.password), database };
}
