# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been released yet. The build follows the eight steps of `DESIGN.md` section 11; steps 1 to 7 are done. The first release, 0.1.0, will be the completed core.

### Added

- Design document (`DESIGN.md`), final: scope, sixteen recorded decisions, domain model, mission lifecycle, roles and access, matching engine, API, CLI, verification plan and build order.
- Domain glossary (`CONTEXT.md`) and the `mission-control-domain` agent skill, which holds the fourteen invariants.
- pnpm workspace with the `contract`, `matcher` and `api` packages. The `cli` package is created by its own build step.
- `contract` package: roles, mission and assignment statuses, transitions, mission event types, and organisation settings with their defaults.
- Postgres 17 in Docker, published on host port 54329, configured from `.env` (copied from `.env.example`).
- Two database roles: an owner that runs migrations and the seed, and an API role that owns no table, is not a superuser and cannot bypass row-level security. The API role can add to `mission_events` and `mission_approvals` but never change or delete them, and cannot create or delete an organisation.
- Database schema for all twelve tables. Every table carries `org_id`, and every foreign key between tenant tables starts with `org_id`, so a row cannot reference another organisation's row.
- Check constraints for every status, role, level, decision and event type, generated from the `contract` package's values.
- An assignment's foreign keys tie its requirement to its own mission and its period to the mission's period, which follows the mission when a draft's period changes.
- Booking rule as a database exclusion constraint (`no_double_booking`): a crew member's held, offered and accepted assignments never overlap in period. Proposed assignments are not held.
- References numbered per organisation and per kind, with the last number kept on the organisation row.
- Seed data for two organisations, Artemis and Helios Labs, with their own skills, settings, users, crew, missions, assignments, approvals and history. Every date is a number of days from `SEED_BASE_DATE`. The seed refuses to run when `NODE_ENV` is `production`, and changes nothing if its data is unsound.
- Password hashing with scrypt.
- `pnpm demo:setup` (start Postgres, create roles and databases, migrate, seed, build; safe to repeat) and `pnpm demo:reset` (reseed).
- Unit tests (`pnpm test`, no database) and integration tests (`pnpm test:int`, against a separate test database) covering tenant references, the booking rule, assignment integrity, the checked values, the API role's privileges and the seed.
- `Makefile` wrapping the common setup, test and database commands.
- `CLAUDE.md` and `docs/agents/` describing the issue tracker, triage labels and domain docs for coding agents.
- GitHub Actions workflow (`CI`) that typechecks, checks the migrations match the schema, and runs the unit and integration tests against Postgres on every pull request and on `main`.
- HTTP API (`pnpm api`, Hono) with `POST /v1/auth/login`, `GET /v1/me`, `GET /v1/org` and `GET /v1/health`.
- Login by organisation slug, email and password, returning a signed token valid for `TOKEN_TTL` (12 hours by default). Every failed login gives the same answer, and the lookup goes through one privileged database function.
- Every authenticated request runs in one database transaction, as the API role, with `app.org_id` set from the token for that transaction only. Any error, or any response of 400 or above, rolls it back.
- One policy module declaring who may do what. Routes are declared with the permission they need, and the request pipeline refuses to run a handler registered without one. Typed domain errors are rendered by one handler in a single error shape.
- Every request checks that the token's user still exists, so a removed user's token stops working at once.
- A test of the code structure rules: modules reach the database only through the request's transaction, and services and repositories import no HTTP.
- Request and response schemas and error codes in the `contract` package.
- Tenant isolation tests: a sweep that calls every route as each organisation and finds nothing of the other, and a coverage test that fails when a route is missing from the sweep.
- Skills, crew and availability: `GET /v1/skills`; `GET`, `POST /v1/crew`; `GET`, `PATCH /v1/crew/:ref`; `PUT`, `DELETE /v1/crew/:ref/skills/:skill`; `GET`, `POST /v1/crew/:ref/availability`; `DELETE /v1/availability/:ref`. A crew member may write `me` for their own record.
- Permissions with a scope: a crew member reads and edits only their own crew record and availability, and any other answers 404.
- References (`CRW-n`, `AVL-n`) numbered per organisation, taken inside the creating transaction.
- The isolation sweep now also calls every route that names a record with another organisation's references, and checks every response carries no internal id.
- `CODING_STANDARDS.md`: the rules for writing code here, each with the reason it was adopted.
- `README.md` with setup steps and a log of where the build diverged from the design.
- `pnpm lint`: ESLint with typescript-eslint, refusing type assertions other than `as const` and non-null assertions, plus knip, which finds unused exports, files and dependencies. CI runs it before the typecheck.
- `pnpm test:coverage`: the unit and integration tests in one run, as two Vitest projects, reporting every file's uncovered lines. CI runs it in place of the integration tests and fails when coverage falls below the recorded thresholds.
- The domain skill's definition of done now includes recording every divergence from the design in the README.
- Missions: `GET`, `POST /v1/missions`; `GET`, `PATCH /v1/missions/:ref`; `GET /v1/missions/:ref/events`; `PUT`, `DELETE /v1/missions/:ref/requirements/:skill`. A mission is changed only while it is a draft, and a new period moves its assignments' periods in the same transaction.
- The mission lifecycle: `POST /v1/missions/:ref/{submit,approve,reject,launch,complete,cancel}`, driven by one transition table. Each transition locks the mission, changes its status only from the one expected, moves its assignments (`proposed → held → offered`, `held → proposed`, `→ released`) and writes a history event, all in one transaction.
- Approval by policy: a submission is approved once enough distinct directors have approved it (`approvalState`); the submitter can never approve or reject; a rejection ends the submission, so a resubmission starts from zero. Submit is refused when too few directors other than the submitter could approve.
- A crew member sees only the missions they are offered or accepted on, and only their own slot.
- Error codes `SELF_APPROVAL_FORBIDDEN`, `TRANSITION_NOT_ALLOWED`, `GUARD_FAILED`, `NOT_DRAFT` and `REQUIREMENT_STAFFED`.
- A table-driven test of every transition, from every status, by every role.
- The architecture test checks that a mission's status changes only through the lifecycle module (DESIGN.md section 9, rule 3).
- A glossary test reads the words `CONTEXT.md` says to avoid and finds any in the source, tests and comments included.
- The `matcher` package: `match(input)` proposes crew for a mission's open slots, a pure function that imports nothing from the API. Seven hard constraints, each recording why it failed; proficiency, workload and rest scorers weighted by the organisation's settings; a hand-written Hungarian solver over whole-number costs that fills the most slots, then makes the fewest clashes, then gets the best total score. The output gives each slot's choice with its score breakdown, up to three alternates, the reasons a slot went unfilled with its two nearest misses, any clash it could not avoid, and crew with a required skill who were left out.
- Match weights must not be negative, and must not all be zero.
- `PLACED_ASSIGNMENT_STATUSES` and `isLiveStatus` in the contract, for the statuses that put a crew member in a slot and those that hold them.
- `test/arrange.ts`: one way for tests to arrange missions and crew the API cannot yet create, taking references from the organisation's counters.
- Match runs: `POST /v1/missions/:ref/match` runs the matcher over a mission's open slots with the organisation's weights and saves the proposal and its explanation as `RUN-n`, changing nothing else; `GET /v1/match-runs/:ref` shows it to the mission's owner and directors; `POST /v1/match-runs/:ref/apply` turns it into assignments, all or nothing and once, after checking every chosen crew member again. A run that would make a clash needs `allow_clashes`.
- Hand assignment: `POST /v1/missions/:ref/assignments` puts a named crew member in an open slot under the same hard constraints and reasons as the matcher, with no override; `DELETE /v1/assignments/:ref` releases one crew member; `DELETE /v1/missions/:ref/assignments` releases a draft's proposals.
- Crew are proposed on a draft and offered on an approved mission, and each assignment records its match run or who assigned it, and its score. A mission's response lists the crew in each requirement.
- Responding: `GET /v1/assignments` lists a crew member's own offered and accepted assignments; `POST /v1/assignments/:ref/{accept,decline}` answer their own offer, a decline with an optional reason. A decline reopens the slot, and the matcher never chooses that crew member for the mission again.
- Error codes `NOT_STAFFABLE`, `NO_OPEN_SLOT`, `HARD_CONSTRAINT_FAILED`, `RUN_ALREADY_APPLIED`, `RUN_OUT_OF_DATE`, `CLASH_NOT_ALLOWED` and `WRONG_ASSIGNMENT_STATUS`.
- `assessCandidate` in the matcher: one crew member weighed for one slot, shared by the matcher, hand assignment and applying a run.
- A test runs the matcher over the seed and checks the outcomes the design names: Titan Relay's unfilled geologist slot with its reasons, Ben and Ada on Io Flyby, and Ada, Quin and then Mina on Europa Survey.
- The isolation sweep covers the new routes, calling the crew-only ones as a crew member of each organisation.
- The proposal check: every mission read shows each proposed crew member's problems, as data, worked out from the data as it is: a clash with another draft, naming it and its owner, or a hard constraint they now fail. A proposal that makes a clash writes a `clash` event into the other mission's history.
- Submit is refused, listing every problem, while any proposal has one, and while a slot is open unless the organisation allows unfilled submission.
- An availability block over a held, offered or accepted assignment is refused (`CREW_HELD`), naming the mission only for offered and accepted ones; one over a proposal is accepted, and the draft shows the problem.
- A second hold on a crew member over an overlapping period, refused by the database's booking rule, answers 409 (`CREW_HELD`).
- Integration tests for all seventeen clash scenarios of `DESIGN.md` section 10, numbered to match, and for two requests taking a hold at the same moment.
- The `cli` package and `bin/mctl`, which runs it from the repository: `mctl login`, `logout`, `whoami`, `status`, `profile list` and `profile use`. A login asks for the password with a hidden prompt, or reads it with `--password-stdin`; there is no `--password` flag.
- Named profiles in `~/.config/mctl/config.json` (or `MCTL_CONFIG`), readable only by the user; the first login becomes current, and `--profile` or `MCTL_PROFILE` overrides it for one command.
- Every command prints who it acts as on the error stream, `--json` prints the API's answer as it came, colour is used only on a terminal, and errors print the API's message and hint with the exit codes of `DESIGN.md` section 8. An expired login prints the exact command to log back in; an API that cannot be reached is named, with the command that starts it.
- `pnpm demo:login`: the six demo profiles, with `lead` current.
- Node 22.18 or later, which runs the CLI's TypeScript without a build.
- `pnpm lint` runs the glossary test, so a word `CONTEXT.md` avoids fails the first lint. A file may now be excused more than one avoided word.
- `test/locks.ts`: `waitsForRowLock` holds a record's row lock from a test and reports whether a request waits on it. `CODING_STANDARDS.md` asks that a test of a lock fail without the lock.
- Every primary workflow from `mctl`, in the walk-through's order: `mission create|list|show|require|unrequire|submit|approve|reject|launch|complete|cancel|history`; `match run|show|apply`; `assignment list|add|remove|clear|accept|decline`; `crew list|show|add`, `crew skill set`; `availability add|list|remove`; `skill list`; `org show`.
- `mctl match run` and `match show` print the match run as `DESIGN.md` section 8 lays it out: the verdict first, a block per slot with each score component's points in words, the alternates, an unfilled slot's losses, nearest misses and the commands that would fill it, any clash, up to five crew excluded with the skill, and a footer naming the run and the next commands. `--apply` applies the run straight after.
- `mctl match apply` asks before applying a run that makes a clash, naming it, unless `--yes` is given. `mission cancel`, `assignment remove`, `assignment clear` and `availability remove` ask first too; without a terminal to ask on they refuse unless given `--yes`.
- `mctl mission show` prints a line per slot, with the crew member, score, status, who chose them and any problem, and who has approved; `mission list` marks every clash; `mission approve` reports progress while more approvals are needed. A successful change prints the likely next command.
- A score component in a match run now says what it was worked out from: the level held, the days assigned out of the 180 around the start, or the days rested (null for one who has never flown). A nearest miss gives the level they hold the skill at.
- Integration tests that run the three acts of the walk-through through `mctl`, and check that every command answers with only JSON under `--json`, finding the commands from `mctl`'s own help.

### Fixed

- Type assertions and non-null assertions in the seed and the tests, replaced by checked lookups (`onlyRow`) and contract schemas. Removing one exposed a mistyped isolation sweep entry, now typed to what a test caller returns.
- `PERMISSIONS` and `CrewSeed` are no longer exported, as nothing outside their files uses them.
- A stored password hash cut short is now covered by a test.
- Listing crew skills no longer special-cases an empty list of crew; the query handles it.
- Names the glossary avoids, in tests: `member` for a crew member, `otherLead` for another mission lead.

### Changed

- Coverage thresholds rise to the level now reached: statements and lines 98%, branches 98.5%.

[Unreleased]: https://github.com/philvenegas/mission-control/commits/main
