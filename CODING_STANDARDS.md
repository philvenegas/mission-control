# Coding standards

How code is written in this repository. `DESIGN.md` says what to build and `CONTEXT.md` says what things are called; this file says how. Each rule was learned during the build, mostly from code review, and carries its reason.

A rule here outranks a general habit. Where a rule and `DESIGN.md` disagree, the design wins and the conflict is raised, not worked around.

## Scope

- **No placeholders.** A package, file, export or setting exists only once something uses it and a test covers it. An empty package "for later" is created by the step that fills it. *Step 1 first shipped empty `matcher` and `cli` packages and settings for a later step; all were removed.*
- **No unused exports.** A helper written for a future caller is deleted until that caller exists.
- **Build one step at a time.** Settings, tables and helpers arrive with the step that needs them.
- **Record every divergence from the design** in the README section "Where the build diverged from the design", with its reason, in the same change. That includes things the design asked for that are deferred, and detail added that the design left open (for example, seed crew it did not name).

## Names

- **Use the glossary's term, in full.** `crewMember`, not `member`; `missionLeads`, not `leads`. The `_Avoid_` lists in `CONTEXT.md` apply to variables, test names, SQL aliases and comments, not only to prose.
- **A name says what the value holds.** No `t`, `n`, `m`; no reusing one name for two things in a function. A list is named for what is in it (`betweenTenantTables`, not `single`).
- **Where the design fixes a name, keep it,** even against the glossary (`no_double_booking`).

## Domain values live in the contract

- **One definition per set of values.** Roles, statuses, transitions, levels and default settings are constants in `packages/contract`. Everything else derives from them: TypeScript types, database check constraints, seed data.
- **Never restate them as literals** in SQL, schema or tests. Where SQL must be hand-written (the booking rule's migration), a test ties it back to the contract's constant.
- **Give a domain concept a small type** instead of passing a bare string: a period is a `Period` and is written to the database by one function that validates it.

## Database

- **The database enforces what must never be wrong.** If an invariant can be a constraint, it is one, and application checks only improve the error message. Examples in place: composite foreign keys for tenancy, the exclusion constraint for double booking, a foreign key that keeps an assignment's period equal to its mission's.
- **Every tenant table has `org_id`, and every foreign key between tenant tables starts with `org_id`.**
- **Every column with a fixed set of values has a check constraint,** generated from the contract.
- **A copied column is tied to its source.** If a value is duplicated for a constraint's sake, a foreign key keeps the copy equal.
- **Grant the API role the minimum.** It owns no table. Append-only tables (`mission_events`, `mission_approvals`) are insert and read only. A new table states its grants deliberately.
- **Change the schema in `schema.ts`, then generate the migration.** CI fails if the two differ. Hand-written SQL goes in a custom migration with a comment saying why.
- **Migrations already on `main` are never rewritten;** add a new one.

## Raw SQL and scripts

- **Values go in as parameters.** Where SQL cannot take a parameter (role and database names), the text is validated as a plain identifier by one function before it is used, and that function's rejections are tested.
- **Setup scripts are safe to run again** and say what each step did.
- **Read configuration through `requireEnv`,** which names the missing setting and how to create it. No `process.env.X!`.

## Errors

- **Errors are thrown, never returned,** and say what is wrong in the user's terms, naming the record.
- **Validate before writing.** A failed operation leaves nothing behind: do the work in one transaction, and test that existing data is untouched after a refusal.

## Types

- **No casts to get past the compiler** (`as unknown as`, `as [...]`, `!` on a lookup that can miss). Fix the type instead: widen a parameter to the shared supertype, or make an impossible case unrepresentable (`Exclude<MissionStatus, 'cancelled'>`).
- **A lookup table over a union is a full `Record`,** not a `Partial` read with `!`.
- **Use the contract's type** (`Role`) rather than deriving one from a table.

## Tests

- **Every branch that can throw has a test,** including guards in scripts. The guard in front of raw SQL was the review's most serious finding precisely because it was untested.
- **Write the test first** where the behaviour is known, and name it as behaviour: `refuses a second live assignment that overlaps, whatever the application does`.
- **Test through the real thing.** Database rules are tested against Postgres, not mocked. Unit tests (`*.test.ts`) need no database; integration tests (`*.int.test.ts`) use the test database.
- **Assert the outcome a person would check:** calendar dates, references, names. Not row counts alone.
- **No magic numbers.** Derive the expectation from the source (the list of tables from the schema), so the test stays true when the source grows.
- **Every invariant in the domain skill that a change touches is exercised by a test in that change.**
- **A red or flaky test is fixed when seen,** whoever caused it. Run a new integration test twice before calling it stable.

## Seed data

- **Every date is a number of days from `SEED_BASE_DATE`,** with the calendar date in a comment.
- **The seed is data plus one runner.** The runner validates the data and refuses the whole run if it is unsound.
- **Seeded history is plausible:** events fall where they would have happened relative to the mission's period.
- **An outcome the walk-through depends on must not rest on a tie.** If two crews score the same, change the data and record why.

## Simplicity

- **Prefer quality, simplicity and robustness over speed of writing.**
- **No wrappers or layers without a present need.** One direct path first.
- **No obscure control flow.** If a loop needs a comment to explain how it terminates or why a sentinel works, rewrite it.
- **Do not hide output.** A script prints every step it took, duplicates included.

## Change process

- **Never commit to `main`.** Branch from the latest `main`; commit only when asked.
- **Every pull request updates `CHANGELOG.md`** (Keep a Changelog) and keeps it true: an entry describing something that no longer exists is a defect.
- **Merge only when the `check` workflow is green.** GitHub cannot enforce this on the current plan, so it is a rule.
- **Review before merge** on two separate axes: these standards, and the issue plus the design sections it names.
