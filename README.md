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
pnpm test:coverage   # both, with every file's uncovered lines
pnpm lint            # lint, and find unused exports, files and dependencies
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
- **A crew member edits their own name and skills, but only a director makes a crew member active or inactive** (design section 5, "Crew profiles: read and edit own"). The design does not split the profile; being taken off or put back on the roster is a director's decision.
- **Adding a crew member takes only a name.** Users are seeded (a non-goal of the design is managing them), so a new crew member cannot yet be linked to a login.
- **Skills are named exactly as the taxonomy spells them** (`EVA`, `field medicine`), case included.
- **The isolation sweep compares whole values.** A response leaks when any string value in it equals one of the other organisation's names, emails, slugs or ids; it also must contain no internal id at all. Comparing substrings flagged Artemis's `medic` inside Helios Labs' `field medicine`.
- **A crew member's response includes the email of the user they log in as** (`user_email`, null when they have none). The design addresses a user by email (section 3), so this is a name, not an internal id; it is visible to every role that can read the crew member.
- **The scope of a permission is checked in the service, not the middleware** (design section 5, "checked by one middleware"). The middleware checks the role holds the permission (403 if not); whether the record is the caller's own can only be known once the record is found, so the service applies the scope through one policy function (`reaches`) and answers 404 for a record outside it.
- **The role check comes before the record lookup.** A user whose role cannot use a route gets 403 whether or not the record exists, so a mission lead of one organisation naming another's crew member gets 403, not the 404 of design section 10. The answer is identical either way, so it reveals nothing; a test checks the two answers match.
- **Names are at most 120 characters and availability reasons at most 500.**
- **Each row of the transition table names the permission it needs, not a list of roles** (design section 4, `{ from, to, roles, guard, effect }`). Who holds a permission, and whether only for their own missions, is declared once in the policy module; the table points at it. `cancel` is therefore two rows: the owner or a director before the mission is under way, a director only once it is `active`. The table is `modules/missions/lifecycle.ts`, beside the rest of the missions module, rather than `src/missions/lifecycle.ts`.
- **A transition can decide to leave the mission where it is.** Approval records the director's decision, then changes the status only when the approval policy is met. Every approval writes a history event, including one that leaves the mission `submitted` (its event goes from `submitted` to `submitted`), so the history shows each director's approval. A rejection is recorded as a decision too, ending the submission.
- **A transition locks the mission's row first,** as well as changing the status with `UPDATE ... WHERE status = <expected>`. Without the lock, two directors approving at the same moment would each count only their own approval, and a mission needing two would stay `submitted` with both. With it, the conditional update is a second line of defence that no test can reach.
- **Refusals have their own codes** (design section 7 documents `SELF_APPROVAL_FORBIDDEN` only): `TRANSITION_NOT_ALLOWED` (409) when the mission's status does not allow the transition, `GUARD_FAILED` (409) when a guard does not hold, `NOT_DRAFT` (409) for a change to a mission that is no longer a draft, and `REQUIREMENT_STAFFED` (409), below. A role that may never make a transition gets 403 at once; otherwise a status that does not allow it gets 409 before the caller's ownership is checked, and an owner-only permission on someone else's mission gets 403.
- **"Period in the future" means the mission starts after today** (UTC), so a mission starting today cannot be submitted.
- **A requirement cannot be removed while crew are proposed for it, nor its headcount cut below their number** (`REQUIREMENT_STAFFED`). The design leaves this open; removing proposals silently would lose the mission lead's plan.
- **Submit does not yet run the proposal check or require every slot filled.** The issue moves both guards to the proposal check, clashes and holds step; here submit checks the requirements, the start date and the directors able to approve.
- **What a mission response carries** (the design leaves it open): its owner and submitter by name and email, its requirements, and `approval`: how many approvals the organisation requires and who has approved the current submission (nobody while the mission is a draft). A crew member sees a reduced shape, the mission's reference, name, period and their own slot (assignment reference, skill, status), and only for missions they are offered or accepted on.
- **A mission lead reads the history of their own missions only;** another's answers 403, since they can see the mission itself. A crew member cannot read history at all.
- **Reject and cancel need a note; the other transitions take one optionally.** A mission's description is optional and at most 2,000 characters; notes are at most 500. A change of period gives both `from` and `to`.
