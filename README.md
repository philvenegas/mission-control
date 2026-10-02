# Mission Control

A multi-tenant platform where space organisations plan missions and staff them with crew.
This README is completed in the last build step; until then it records how to set up and where the build diverged.

## Setup

Prerequisites: Docker, Node 22 and pnpm.

```
pnpm install
pnpm demo:setup      # start Postgres, create roles and databases, migrate, seed, build
pnpm api             # the API on http://localhost:3000, in a terminal of its own (PORT in .env changes it)
pnpm test            # unit tests; no database needed
pnpm test:int        # integration tests, against a separate test database
pnpm demo:reset      # reseed
```

`make` lists the same commands as Makefile targets.

Every seeded user has the password `mission-control-demo`. To log in:

```
curl -s -X POST localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"org":"artemis","email":"dana@artemis.example","password":"mission-control-demo"}'
```

## Where the build diverged from the design

Each entry is added when the divergence happens. `DESIGN.md` is not edited.

- **Ben Osei is also on Lunar Gateway Resupply** (seed, design section 10). The design lists Kira, Leo, Cy and Mina. With Ben free, the Europa Survey walk-through has two crews of exactly equal total score (Ada as pilot with Quin as medic, or Ben as pilot with Ada as medic: 91 + 82 against 86.5 + 86.5), so the required outcome would rest on a tie-break. Ben's recent workload makes Ada and Quin the clear answer. The mission now needs two pilots.
- **Seeded periods are stored exactly as the design writes them, with the end exclusive.** "1–20 Mar 2027" is stored as `[2027-03-01, 2027-03-20)`, following the glossary's definition of a period. This keeps Mina's rest before Europa Survey at the 19 days the design states.
- **The `matcher` and `cli` packages do not exist yet** (build step 1, design sections 9 and 11). Step 1 lists all four packages, but the project rules forbid placeholder code, so each package is created by the step that fills it: the matcher in step 5, the CLI in step 7.
- **The test that runs the matcher over the seed is deferred to step 6** (design section 10), since it needs the matcher. Until then the outcomes the seed is built to produce (MSN-6, MSN-7 and Europa Survey, including the scores behind Ben's place on Lunar Gateway Resupply) are worked out by hand and not yet proved by a test.
- **Seed crew the design does not name.** The design says which crew matter to each mission but not every slot. To give each seeded mission a complete, believable crew: Mars Relay Repair (completed) has Noor Haddad as engineer and Rosa Imani on comms; Ceres Resupply also proposes Noor as engineer; Vesta Mapping also proposes Sven Dahl as geologist. Mars Relay Repair ended more than 90 days before any 2027 mission starts, so it adds nobody's workload to a walk-through score.
- **An assignment's period cannot differ from its mission's** (design section 3). The design copies the period onto the assignment; the build also makes it part of the foreign key to the mission, with a cascade, so the database keeps the two equal when a draft's period changes. The same key ensures an assignment's requirement belongs to its own mission.
- **The API database role cannot rewrite history.** Beyond the design's "does not own the tables", it may only read and add rows in `mission_events` and `mission_approvals`, and cannot create or delete an organisation.
- **`mission_events.type` allows `clash`** as well as the transitions, for the history event the design gives a mission when another draft's proposal creates a clash (design section 4).
- **`GET /v1/org` answers 403, not 404, to mission leads and crew members** (design section 5). The design gives them no access to organisation settings. They do know their organisation exists (`GET /v1/me` names it), so this is "seen but not permitted".
- **A caller who is not logged in gets 401 for every address under `/v1`,** including ones that do not exist, so the API does not reveal its routes to them. Only `GET /v1/health` and `POST /v1/auth/login` answer without a login.
- **Every request checks that the token's user still exists** in the token's organisation, so a removed user's token stops working at once on every route, not at expiry. The role is still taken from the token, as the design says, so a changed role takes effect at the next login.
- **Login answers with more than a token** (design section 5): it also returns who the token acts as, their organisation, and when the token expires, which the CLI needs for its "acting as" line and expiry message.
- **Login reads the organisation slug and the email without regard to case.** Stored emails are lower case; whatever later creates users must store them so.
- **The login failure message is "Invalid organisation, email or password."**, capitalised and with a full stop, and carries a hint. The design's wording is lower case; the meaning and the uniformity are the same.
- **`TOKEN_SECRET` must be at least 16 characters,** or the API refuses to start.
- **Routes are declared as data, each with the permission it needs** (design section 9). Each module has a `routes.ts` beside its service and repository; the request pipeline refuses to run any handler registered without a permission. The `org` and `users` modules are additions to the design's module list, for `GET /v1/org` and `GET /v1/me`.
- **Login makes the one query that is outside a request's transaction** (design section 9, rule 2), because no tenant is known yet. It is confined to `auth/repository.ts` and the privileged `auth_find_user` database function.
- **The isolation sweep has no "reference gives 404" check yet** (design section 10). No route takes a reference until step 3, which adds that half of the sweep with the first such routes.
