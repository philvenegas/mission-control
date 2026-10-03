# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been released yet. The build follows the eight steps of `DESIGN.md` section 11; steps 1 to 4 are done. The first release, 0.1.0, will be the completed core.

### Added

- Design document (`DESIGN.md`), final: scope, sixteen recorded decisions, domain model, mission lifecycle, roles and access, matching engine, API, CLI, verification plan and build order.
- Domain glossary (`CONTEXT.md`) and the `mission-control-domain` agent skill, which holds the fourteen invariants.
- pnpm workspace with the `contract` and `api` packages. The `matcher` and `cli` packages are created by their own build steps.
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
- `test/arrange.ts`: one way for tests to arrange missions and crew the API cannot yet create, taking references from the organisation's counters.

### Fixed

- Type assertions and non-null assertions in the seed and the tests, replaced by checked lookups (`onlyRow`) and contract schemas. Removing one exposed a mistyped isolation sweep entry, now typed to what a test caller returns.
- `PERMISSIONS` and `CrewSeed` are no longer exported, as nothing outside their files uses them.
- A stored password hash cut short is now covered by a test.
- Listing crew skills no longer special-cases an empty list of crew; the query handles it.
- Names the glossary avoids, in tests: `member` for a crew member, `otherLead` for another mission lead.

[Unreleased]: https://github.com/philvenegas/mission-control/commits/main
