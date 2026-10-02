# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been released yet. The build follows the eight steps of `DESIGN.md` section 11; step 1 is done. The first release, 0.1.0, will be the completed core.

### Added

- Design document (`DESIGN.md`), final: scope, sixteen recorded decisions, domain model, mission lifecycle, roles and access, matching engine, API, CLI, verification plan and build order.
- Domain glossary (`CONTEXT.md`) and the `mission-control-domain` agent skill, which holds the fourteen invariants.
- pnpm workspace with four packages: `contract`, `matcher`, `api` and `cli`. The `matcher` and `cli` packages are placeholders until their build steps.
- `contract` package: roles, mission and assignment statuses, organisation settings, and formatting and parsing of references (`MSN-12`, `CRW-7`).
- Postgres 17 in Docker, published on host port 54329, configured from `.env` (copied from `.env.example`).
- Two database roles: an owner that runs migrations and the seed, and an API role that owns no table, is not a superuser and cannot bypass row-level security.
- Database schema for all twelve tables. Every table carries `org_id`, and every foreign key between tenant tables is composite on `(org_id, id)`, so a row cannot reference another organisation's row.
- Booking rule as a database exclusion constraint (`no_double_booking`): a crew member's held, offered and accepted assignments never overlap in period. Proposed assignments are not held.
- References numbered per organisation and per kind, with the last number kept on the organisation row.
- Seed data for two organisations, Artemis and Helios Labs, with their own skills, settings, users, crew, missions, assignments, approvals and history. All dates are offsets from `SEED_BASE_DATE`. The seed refuses to run when `NODE_ENV` is `production`.
- Password hashing with scrypt.
- `pnpm demo:setup` (start Postgres, create roles and databases, migrate, seed, build; safe to repeat) and `pnpm demo:reset` (reseed).
- Unit tests (`pnpm test`, no database) and integration tests (`pnpm test:int`, against a separate test database) covering the composite foreign keys, the booking rule, the API role's privileges and the seed.
- `Makefile` wrapping the common setup, test and database commands.
- `CLAUDE.md` and `docs/agents/` describing the issue tracker, triage labels and domain docs for coding agents.
- `README.md` with setup steps and a log of where the build diverged from the design.

[Unreleased]: https://github.com/philvenegas/mission-control/commits/main
