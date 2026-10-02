# Mission Control

A multi-tenant platform where space organisations plan missions and staff them with crew.
This README is completed in the last build step; until then it records how to set up and where the build diverged.

## Setup

Prerequisites: Docker, Node 22 and pnpm.

```
pnpm install
pnpm demo:setup      # start Postgres, create roles and databases, migrate, seed, build
pnpm test            # unit tests; no database needed
pnpm test:int        # integration tests, against a separate test database
pnpm demo:reset      # reseed
```

## Where the build diverged from the design

Each entry is added when the divergence happens. `DESIGN.md` is not edited.

- **Ben Osei is also on Lunar Gateway Resupply** (seed, design section 10). The design lists Kira, Leo, Cy and Mina. With Ben free, the Europa Survey walk-through has two crews of exactly equal total score (Ada as pilot with Quin as medic, or Ben as pilot with Ada as medic: 91 + 82 against 86.5 + 86.5), so the required outcome would rest on a tie-break. Ben's recent workload makes Ada and Quin the clear answer. The mission now needs two pilots.
- **Seeded periods are stored exactly as the design writes them, with the end exclusive.** "1–20 Mar 2027" is stored as `[2027-03-01, 2027-03-20)`, following the glossary's definition of a period. This keeps Mina's rest before Europa Survey at the 19 days the design states.
