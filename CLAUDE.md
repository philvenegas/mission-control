# Mission Control

A multi-tenant API and a CLI (`mctl`) where space organisations plan missions and staff them with crew. TypeScript pnpm workspace: `packages/contract`, `matcher`, `api` and `cli`; Postgres in Docker.

- `DESIGN.md` is the final design and guides the build. Do not edit it; record any divergence, with its reason, in the README section "Where the build diverged from the design".
- The build follows `DESIGN.md` section 11, one GitHub issue per step. Each step ends with passing tests.
- Commit only when asked.
- `CODING_STANDARDS.md` says how code is written here. Read it before writing or reviewing code.

## Commands

```
pnpm demo:setup      # start Postgres (port 54329), create roles and databases, migrate, seed, build
pnpm demo:reset      # reseed
pnpm test            # unit tests; no database
pnpm test:int        # integration tests, against the test database
pnpm build           # typecheck every package
```

After changing `packages/api/src/db/schema.ts`, run `pnpm --filter @mission-control/api db:generate`.

## Agent skills

### Domain skill

Use the `mission-control-domain` skill when writing or reviewing code, tests, seed data, CLI output or docs. It holds the invariants and points to the vocabulary and the mechanics.

### Issue tracker

Issues live in GitHub Issues at `philvenegas/mission-control`, driven with the `gh` CLI; blocking uses native issue dependencies. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` is the glossary and `DESIGN.md` holds the decisions, both at the repo root. See `docs/agents/domain.md`.

### Instructions

- update the CHANGELOG.md for any PR, follow https://keepachangelog.com/en/1.1.0/ as a guide
- follow semantic versioning
- When making technical decisions, do not give much weight to development cost. 
  Instead, prefer quality, simplicity, robustness, scalability, and long term maintainability.
- For one-off or infrequent operational work, start with the simplest direct end-to-end path. Do not build wrappers, control planes, policy layers, custom verifiers, or automation unless the direct path exposes a concrete blocker or repeated need that justifies the added machinery.
- never commit code to the 'main' branch, branch off latest 'main' and tell me the new branch name within a session.
- make sure there are coprehensive tests for every piece of code that you write, follow tdd and bdd to make changes.
- never have a placeholder, only have implemented code and functions that are tested and working.
- Apply that same high standard to engineering excellence: lint, test failures, and test flakiness.
  If you see one, even if it is not caused by what you are working on right now, still get it fixed.
