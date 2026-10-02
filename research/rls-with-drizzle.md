# Cost of row-level security with Drizzle and postgres.js

Research for issue #3. Feeds the "Tenant isolation depth" decision (issue #4).
Date: 2026-10-02.

## Answer in brief

Row-level security (RLS) as described in `DESIGN.md` section 5 is feasible with Drizzle and postgres.js and needs no extra libraries. It takes six pieces of work: a non-owner role, policies in the schema, one hand-written migration for grants, a per-request transaction that calls `set_config`, a `SECURITY DEFINER` login function, and a test setup with two connections.

Estimated extra cost over the no-RLS alternative: **60 to 90 minutes** of the 5-hour budget (my estimate, not from a source). The alternative (scoped queries, composite foreign keys, isolation tests) costs **45 to 60 minutes**, and all of that work is also needed with RLS, because decision D3 keeps scoped data access as the first layer.

## How claims are marked

- **[doc]** stated by a primary source, linked.
- **[probe]** observed in a throwaway run on 2026-10-02: Postgres 17 (Docker `postgres:17`), `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11, `postgres` 3.4.9, Node 22. The probe used three tables shaped like `organisations`, `users` and `missions`. The probe code is not committed.
- **[estimate]** my judgement. No source supports it.

## Steps

### 1. Two database roles

The API must connect as a role that is not a superuser, does not have `BYPASSRLS`, and does not own the tables. Migrations and seeds run as the owner.

- "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system when accessing a table." [doc: [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)]
- "Table owners normally bypass row security as well", unless the table has `FORCE ROW LEVEL SECURITY`. [doc: same page]

```sql
-- docker-entrypoint-initdb.d/01-roles.sql, or a custom migration
CREATE ROLE mc_app LOGIN PASSWORD 'mc_app' NOSUPERUSER NOBYPASSRLS;
```

Two connection strings follow: `DATABASE_URL` (owner, for migrate and seed) and `APP_DATABASE_URL` (`mc_app`, for the API).

Mark the role as existing in the Drizzle schema so drizzle-kit does not try to manage it [doc: [Drizzle RLS](https://orm.drizzle.team/docs/rls)]:

```ts
export const appRole = pgRole('mc_app').existing();
```

### 2. Policies in the Drizzle schema

Policies go in the third argument of `pgTable`. "If you add a policy to a table, RLS will be enabled automatically." [doc: [Drizzle RLS](https://orm.drizzle.team/docs/rls)]

```ts
const tenant = sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`;
export const tenantPolicy = () =>
  pgPolicy('tenant_isolation', { as: 'permissive', to: appRole, for: 'all', using: tenant, withCheck: tenant });

export const missions = pgTable('missions', { /* columns */ }, (t) => [
  unique().on(t.orgId, t.id),
  foreignKey({ columns: [t.orgId, t.ownerId], foreignColumns: [users.orgId, users.id] }),
  tenantPolicy(),
]);
```

`drizzle-kit generate` turned this into the following SQL [probe]:

```sql
ALTER TABLE "missions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "missions" AS PERMISSIVE FOR ALL TO "mc_app"
  USING (org_id = ...) WITH CHECK (org_id = ...);
```

Notes:

- `current_setting(name, true)` returns NULL instead of an error when the setting is missing. [doc: [Configuration Settings Functions](https://www.postgresql.org/docs/current/functions-admin.html)]
- If only `USING` is given on an `ALL` or `UPDATE` policy, it is also used as `WITH CHECK`. [doc: [CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)] Writing both is clearer.
- `organisations` has no `org_id`; its policy compares `id` instead, and `for: 'select'` is enough for the API.
- A table with RLS enabled and no policy denies everything. [doc: Row Security Policies] [probe: 0 rows]

### 3. One hand-written migration for what drizzle-kit does not generate

The generated migration contained no `GRANT` and no `FORCE ROW LEVEL SECURITY` [probe]. The Drizzle RLS page documents neither. Generate an empty migration with `drizzle-kit generate --custom --name=rls-grants` [doc: [Custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)] and put this in it:

```sql
GRANT USAGE ON SCHEMA public TO mc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mc_app;
```

`GRANT ... ON ALL TABLES` covers only tables that exist when it runs. `ALTER DEFAULT PRIVILEGES` covers tables the same role creates later; it "does not affect privileges assigned to already-existing objects". [doc: [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)]

The `btree_gist` extension and the exclusion constraint from `DESIGN.md` section 3 need a custom migration in any case, so this file is not extra overhead.

When running migrations from code with postgres.js, use a dedicated client with `max: 1`. [doc: [drizzle-orm postgres-js README](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/postgres-js/README.md)]

### 4. Set the tenant once per request, inside a transaction

```ts
const client = postgres(process.env.APP_DATABASE_URL!);
const db = drizzle(client);

export const withTenant = <T>(orgId: string, fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
```

A Hono middleware calls `withTenant(token.orgId, (tx) => { c.set('tx', tx); return next(); })`. This matches rule 2 in `DESIGN.md` section 9.

- With `is_local` set to `true`, "the new value will only apply during the current transaction". [doc: Configuration Settings Functions]
- postgres.js reserves one connection for the whole `sql.begin` callback and rolls back if anything throws. [doc: [postgres.js README](https://github.com/porsager/postgres#transactions)] Drizzle's `db.transaction` is the wrapper around it. [doc: [Drizzle transactions](https://orm.drizzle.team/docs/transactions)]
- Postgres accepts any two-part setting name such as `app.org_id` without it being declared. [doc: [Customized Options](https://www.postgresql.org/docs/current/runtime-config-custom.html)]
- The bind parameter in `set_config` works [probe]. `SET LOCAL app.org_id = $1` does not: `syntax error at or near "$1"` [probe], which fits the `SET` grammar taking only literals [doc: [SET](https://www.postgresql.org/docs/current/sql-set.html)]. Drizzle's own Supabase example builds the statement with `sql.raw`, which is string interpolation; prefer the bind parameter.

Observed [probe]: tenant A sees only A's missions; tenant B only B's; an insert with another tenant's `org_id` fails with `new row violates row-level security policy`; an update aimed at another tenant's row affects 0 rows.

### 5. Login lookup through a SECURITY DEFINER function

Login happens before any tenant is known, so a direct `SELECT` on `users` as `mc_app` returns nothing. A function owned by the table owner runs with the owner's rights and so bypasses the policy.

```sql
CREATE FUNCTION auth_find_user(p_email text)
  RETURNS TABLE (id uuid, org_id uuid, role text, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT u.id, u.org_id, u.role, u.password_hash FROM users u WHERE u.email = p_email $$;
REVOKE ALL ON FUNCTION auth_find_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO mc_app;
```

```ts
const [row] = await db.execute(sql`select * from auth_find_user(${email})`);
```

- `SECURITY DEFINER` "specifies that the function is to be executed with the privileges of the user that owns it". [doc: [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)]
- Set `search_path` with `pg_temp` last, and revoke the default `PUBLIC` execute privilege. [doc: same page, "Writing SECURITY DEFINER Functions Safely"]
- This goes in the same custom migration. The function worked from `mc_app` with no tenant set [probe].
- The function only bypasses RLS if its owner does. It must be created by the table owner (or a superuser), and the tables must not have `FORCE ROW LEVEL SECURITY` (see pitfall 2).

### 6. Seeds and integration tests

- **Seed as the owner.** The owner bypasses RLS, so the seed can write both organisations without setting a tenant [probe]. Drizzle inserts work unchanged.
- **Tests use two connections.** Setup, fixtures and truncation use the owner connection. The API under test, and the "direct query with B's tenant set returns no A rows" test from `DESIGN.md` section 10, use the `mc_app` connection.
- `TRUNCATE` is "not subject to row security" [doc: Row Security Policies], but `mc_app` has no `TRUNCATE` privilege and gets `permission denied` [probe]. Clean up as the owner.
- Add one test that asserts the API's connection is the safe kind, for example `select rolsuper, rolbypassrls from pg_roles where rolname = current_user` returns false for both, and that a query with no tenant set returns no rows.

## Pitfalls

1. **Connecting as owner or superuser silently disables RLS.** The official Postgres Docker image's `POSTGRES_USER` is a superuser. If the API uses that URL, every policy is ignored and no error appears. The application-level `404` tests would still pass because scoped queries do the filtering. Only a direct-query test or a role assertion catches it. [doc: Row Security Policies] [probe: superuser saw all rows, even with `FORCE`]

2. **`FORCE ROW LEVEL SECURITY` is not a substitute for a separate role, and it has a cost.** It makes a non-superuser owner subject to policies [probe: 2 rows before, 0 after], but it does nothing to a superuser [probe]. It would also make the owner-run seed and the owner-owned login function subject to policies. Recommendation: do not use `FORCE`; use a separate `mc_app` role.

3. **Session-level settings leak across pooled connections.** `set_config(..., false)` or plain `SET` lasts for the session. [doc: SET] postgres.js keeps a pool (default `max` 10) [doc: postgres.js README], so the next request on that connection inherits the tenant. In the probe, after one session-level set, later unrelated queries with no tenant returned tenant A's row. Always pass `true` and always be inside a transaction. `SET LOCAL` outside a transaction "emits a warning and otherwise has no effect" [doc: SET].

4. **Empty string after a transaction ends.** On a fresh connection, `current_setting('app.org_id', true)` is NULL and the policy returns no rows. After a transaction that set it locally, the same connection returns `''`, and `''::uuid` raises `invalid input syntax for type uuid: ""` [probe]. Wrap it: `nullif(current_setting('app.org_id', true), '')::uuid`. I did not find this behaviour stated in the Postgres docs; it is from the probe only.

5. **Grants are separate from policies.** RLS filters rows only after the role has table privileges. A missing `GRANT` gives `permission denied`, not an empty result. drizzle-kit does not generate grants [probe].

6. **Constraints bypass RLS and can reveal that a row exists.** "Referential integrity checks, such as unique or primary key constraints and foreign key references, always bypass row security." [doc: Row Security Policies] In the probe, tenant A inserting a user with tenant B's email got `duplicate key value violates unique constraint "users_email_unique"`. `DESIGN.md` makes `email` globally unique, so user creation can reveal that an email exists in another organisation. The `no_double_booking` exclusion constraint is keyed on `crew_member_id`, which is tenant-specific, so it does not leak across tenants. RLS does not replace composite foreign keys: they are what stops a row in A pointing at a row in B [probe: the composite key rejected it].

7. **Tables without their own `org_id`.** `DESIGN.md` section 3 says all tables carry `org_id`, but the key-field lists for `crew_skills`, `availability_blocks`, `mission_requirements`, `assignments`, `mission_approvals`, `mission_events` and `match_runs` do not show it. Two options:
   - Put `org_id` on every table. The policy is then the same one-line helper everywhere, and the composite foreign keys need the column anyway. Recommended.
   - Write the policy as a sub-select on the parent (`EXISTS (SELECT 1 FROM missions m WHERE m.id = mission_id)`). The docs allow it but warn that "such accesses can create race conditions that could allow information leakage if care is not taken", and the role must be able to access the referenced tables. [doc: Row Security Policies, CREATE POLICY] Each such table needs its own policy text. Not probed.

8. **Every request holds a connection for its full duration.** `sql.begin` reserves a connection for the callback [doc: postgres.js README]. With the default pool of 10, ten slow requests block the eleventh. Fine at this scale. The matcher should not do long CPU work while holding the transaction if that can be avoided.

9. **Errors must roll back.** A handler that catches an error and returns a 4xx response without throwing will commit what it wrote. Throw, or call `tx.rollback()` [doc: Drizzle transactions], and map the error to a response outside the transaction.

10. **Transaction-mode poolers.** Not relevant to Docker Postgres with direct connections. postgres.js notes `prepare: false` for PgBouncer in transaction mode [doc: postgres.js README]. Transaction-local settings are the form that remains correct under such a pooler, since the setting lives and dies inside one transaction. I did not test with a pooler.

11. **Drizzle API naming differs by version.** The current docs page shows `pgTable.withRLS(...)`. In stable `drizzle-orm` 0.45.3 the working form is `pgTable(...).enableRLS()` [probe]. Neither is needed when a table has a policy. I did not check which release introduced `withRLS`.

12. **`UPDATE`, `DELETE` and `RETURNING` also need the row to pass the `SELECT` policy.** [doc: CREATE POLICY] A single `for: 'all'` policy covers this. It matters only if policies are split per command.

## Time cost

All figures are [estimate], for one person driving an AI coding agent, including the agent's debugging loops.

### RLS, on top of the alternative

| Work | Minutes |
|---|---|
| `mc_app` role in Docker init, two connection strings, config | 10 |
| Policy helper applied to about 12 tables | 10 |
| Custom migration: grants, default privileges | 5 to 10 |
| `withTenant` plus Hono middleware (the per-request transaction is wanted anyway for lifecycle and audit writes) | 10 |
| Login `SECURITY DEFINER` function and its call | 10 |
| Test harness with owner and app connections; role assertion; direct-query isolation test | 15 |
| Debugging: permission errors, the empty-string cast, a table missed by grants | 0 to 25 |
| **Total** | **60 to 90** |

That is 20 to 30 percent of the 5-hour budget. The fixed part is about 60 minutes; the rest is risk. The pitfalls above are the known causes of that risk, and an agent given this file should avoid most of them.

A smaller version is possible: same role and policies, but skip the login function by letting login use the owner connection for that one query. It saves about 10 minutes and leaves an owner-level handle inside the API process, which breaks rule 2 in section 9. I do not recommend it.

### The alternative: scoped queries, composite foreign keys, isolation tests, no RLS

| Work | Minutes |
|---|---|
| `org_id` and `UNIQUE (org_id, id)` on every table, composite foreign keys | 15 to 20 |
| Repositories that take `orgId` and add it to every query | 10 to 15 (spread across modules) |
| Isolation tests: user from B requests every A resource and gets `404` | 20 to 25 |
| **Total** | **45 to 60** |

This work is needed with or without RLS, because D3 keeps scoped data access as the first layer and section 3 requires composite keys. So the choice is not 60 to 90 minutes against 45 to 60. It is **45 to 60 minutes without RLS, or 105 to 150 minutes with it**.

What the alternative lacks: a query that forgets its `org_id` filter leaks, and only a test that happens to exercise that query will catch it. Composite foreign keys stop cross-tenant references on write but not cross-tenant reads.

## Not verified

- All time figures. They are estimates.
- Sub-select policies for tables without `org_id` (pitfall 7, second option). Described from the docs only.
- Behaviour behind PgBouncer or any transaction-mode pooler.
- That drizzle-kit can never emit `GRANT` or `FORCE ROW LEVEL SECURITY`. I saw none generated in 0.31.11 and the docs describe none, but I did not read drizzle-kit's source.
- The empty-string behaviour of `current_setting` after a transaction-local set (pitfall 4) is from the probe on Postgres 17 only; I found no doc statement for it.
- Drizzle 1.0 beta behaviour. Everything was run on stable 0.45.3.
- The statement that the Docker image's `POSTGRES_USER` is a superuser is from the probe (the `postgres` user bypassed `FORCE`), not from a fetched page of the image's documentation.
- Performance cost of policies. Not measured; not expected to matter at this data size.

## Sources

- Drizzle ORM, Row-Level Security: https://orm.drizzle.team/docs/rls
- Drizzle ORM, Transactions: https://orm.drizzle.team/docs/transactions
- Drizzle Kit, Custom migrations: https://orm.drizzle.team/docs/kit-custom-migrations
- drizzle-orm postgres-js README (migrations with `max: 1`): https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/postgres-js/README.md
- drizzle-orm 0.36.0 changelog (RLS API): https://github.com/drizzle-team/drizzle-orm/blob/main/changelogs/drizzle-orm/0.36.0.md
- PostgreSQL, Row Security Policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL, CREATE POLICY: https://www.postgresql.org/docs/current/sql-createpolicy.html
- PostgreSQL, ALTER TABLE (ENABLE and FORCE ROW LEVEL SECURITY): https://www.postgresql.org/docs/current/sql-altertable.html
- PostgreSQL, SET: https://www.postgresql.org/docs/current/sql-set.html
- PostgreSQL, Configuration Settings Functions (`set_config`, `current_setting`): https://www.postgresql.org/docs/current/functions-admin.html
- PostgreSQL, Customized Options: https://www.postgresql.org/docs/current/runtime-config-custom.html
- PostgreSQL, CREATE FUNCTION (SECURITY DEFINER): https://www.postgresql.org/docs/current/sql-createfunction.html
- PostgreSQL, ALTER DEFAULT PRIVILEGES: https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html
- postgres.js README: https://github.com/porsager/postgres
