# Mission Control — Design Document

Status: draft for review, written before implementation.
Audience: the engineering team, and the AI coding agent that will implement it.

## 1. What we are building

Mission Control lets a space organisation plan missions and staff them with the right crew. Today a mission lead cross-references skill profiles, calendars and existing commitments by hand. The product replaces that with a matcher that proposes a full crew, explains its reasoning, and never double-books anyone.

The deliverable is a multi-tenant HTTP API and a CLI (`mctl`) that exercises every primary workflow. There is no web interface.

### Scope of the first build

One vertical slice, end to end: a mission lead creates a mission, defines requirements, runs the matcher, applies the proposal and submits; a director approves; crew accept or decline; the lead fills any gap and launches the mission.

### Non-goals

- Real identity provider, password reset, invitations. Users are seeded.
- Users who belong to more than one organisation.
- Notifications (email, chat). Crew see offers by running `mctl assignment list`.
- Partial allocation. A crew member is on at most one mission at a time.
- Team-wide constraints ("at least one medic across the crew") and matching several missions at once. See section 6.6.
- Background jobs. Every state change is an explicit API call.

## 2. Decisions and their reasons

| # | Decision | Reason | Alternative rejected |
|---|---|---|---|
| D1 | TypeScript monorepo: `api`, `cli`, `contract`, `matcher` | One language; the CLI and API share request and response schemas, so they cannot drift | Separate repos or languages |
| D2 | Postgres, shared schema, `org_id` on every table | Standard for B2B at this scale; lets the database enforce isolation and booking rules | Schema or database per tenant: heavier operations for no gain here |
| D3 | Tenant isolation in two layers: scoped data access plus row-level security | "Data must never leak" should not depend on every query remembering a `WHERE` clause | Application-only filtering |
| D4 | Tenant and role come only from the signed token | A client can never name another tenant in a URL or body | `/orgs/:id/...` routes |
| D5 | `User` and `CrewMember` are separate, optionally linked | Crew are schedulable resources even without a login; leads and directors are not crew by default | One table with nullable profile fields |
| D6 | Skills, score weights and approval policy are per-organisation data | The brief says organisations differ in taxonomy and approval process | Global skill list, hard-coded policy |
| D7 | Mission lifecycle is one transition table with guards and effects | One place to read, test and later change the workflow | Status checks scattered through handlers |
| D8 | Crew are proposed before submission, offered on approval, then respond | The director approves a staffable plan; crew are not asked about missions that may be rejected | Confirm-before-submit; assign-after-approval |
| D9 | The approver can never be the submitter, for any role | The brief states it for leads; a director approving their own mission is the same failure | Rule applied to leads only |
| D10 | Matching is a minimum-cost assignment, not a greedy ranking | Greedy can miss a full roster that exists (section 6.3) | Greedy; integer-programming solver |
| D11 | The matcher suggests; a human applies | Leads keep control and the run is an auditable record | Matcher writes assignments directly |
| D12 | Double booking is prevented by a database exclusion constraint | Two leads racing for the same person must fail safely, whatever the code does | Check-then-insert in application code |
| D13 | The CLI holds no business logic | The API is the product; the CLI is one client of it | Shared logic in the CLI |

## 3. Domain model

All tables carry `org_id`. Foreign keys between tenant tables are composite `(org_id, id)`, so a row can never reference another tenant's row even if application code is wrong.

| Table | Key fields | Notes |
|---|---|---|
| `organisations` | `id`, `name`, `slug`, `settings` | `settings`: `approvals_required` (default 1), `min_rest_days` (default 0), `match_weights` |
| `users` | `id`, `org_id`, `email` (globally unique), `password_hash`, `name`, `role` | `role`: `director`, `mission_lead`, `crew_member` |
| `crew_members` | `id`, `org_id`, `ref`, `user_id` (nullable, unique), `name`, `status` | `status`: `active`, `inactive` |
| `skills` | `id`, `org_id`, `name`, `category` | Unique on `(org_id, name)` |
| `crew_skills` | `crew_member_id`, `skill_id`, `level` 1–5, `certified_until` (nullable) | Levels: 1 novice, 3 competent, 5 expert |
| `availability_blocks` | `id`, `crew_member_id`, `period` (daterange), `reason` | Crew are available unless a block says otherwise |
| `missions` | `id`, `org_id`, `ref`, `name`, `description`, `period` (daterange), `status`, `owner_id`, `submitted_by` | `ref` is a per-organisation number shown as `MSN-12` |
| `mission_requirements` | `id`, `mission_id`, `skill_id`, `min_level`, `headcount` | Each unit of headcount is one slot |
| `assignments` | `id`, `mission_id`, `requirement_id`, `crew_member_id`, `period`, `status`, `score`, `decline_reason` | `period` is copied from the mission |
| `mission_approvals` | `id`, `mission_id`, `approver_id`, `decision`, `note`, `created_at` | One row per decision |
| `mission_events` | `id`, `mission_id`, `actor_id`, `type`, `from_status`, `to_status`, `note`, `created_at` | Append-only audit log |
| `match_runs` | `id`, `mission_id`, `created_by`, `result` (jsonb), `created_at` | The saved proposal and its explanation |

Assignment statuses: `proposed`, `offered`, `accepted`, `declined`, `released`. The first three are "live" and hold the crew member's time.

The booking rule, in the database (requires the `btree_gist` extension):

```sql
ALTER TABLE assignments ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (crew_member_id WITH =, period WITH &&)
  WHERE (status IN ('proposed', 'offered', 'accepted'));
```

A proposed assignment on a draft mission holds the crew member. This is deliberate: otherwise a director could approve a plan that is no longer staffable. The cost is that stale drafts can hoard crew; cancelling a mission releases its assignments, and an expiry for old drafts is a later addition.

## 4. Mission lifecycle

```
draft ──submit──▶ submitted ──approve──▶ approved ──launch──▶ active ──complete──▶ completed
  ▲                  │
  └──reject/withdraw─┘          cancel: from draft, submitted, approved or active ──▶ cancelled
```

| Transition | Who | Guard | Effect |
|---|---|---|---|
| `submit` | Owner (lead) or director | At least one requirement; period in the future; every slot has a proposed crew member | Sets `submitted_by` |
| `withdraw` | Submitter | — | Back to `draft` |
| `reject` | Director, not the submitter | Note required | Back to `draft`; assignments stay `proposed` |
| `approve` | Director, not the submitter | Has not already approved this submission | Records approval. When approvals reach `approvals_required`: status `approved`, assignments `proposed → offered` |
| `launch` | Owner or director | Every slot `accepted` | Status `active` |
| `complete` | Owner or director | — | Status `completed` |
| `cancel` | Owner or director; director only once `active` | Note required | Live assignments `→ released` |

Rules that follow from this:

- A mission's requirements, period and crew can be edited only in `draft`. What the director approves is exactly what was submitted.
- Changing the period in `draft` updates the period on its assignments in the same transaction; the exclusion constraint rejects the change if it creates a clash.
- After approval, a crew member's decline reopens that slot. The lead reruns the matcher for the gap and the replacement is created directly as `offered`. No second approval is needed. A per-organisation "re-approve on crew change" policy is a later addition.
- Each transition runs as `UPDATE ... WHERE status = <expected>`, so two concurrent transitions cannot both succeed.
- Every transition writes a `mission_events` row in the same transaction.

The whole table lives in one module (`lifecycle.ts`) as data: `{ from, to, roles, guard, effect }`. A new approval process means changing that table and the policy settings, not the handlers.

## 5. Roles and access

| Capability | Director | Mission lead | Crew member |
|---|---|---|---|
| Organisation settings, users | Manage | — | — |
| Skills taxonomy | Manage | Read | Read |
| Crew profiles | Manage all | Read all | Read and edit own |
| Availability | Manage all | Read all | Manage own |
| Missions | Read all, create, edit any draft | Read all, create, edit own drafts | Read only missions they are assigned to (name, period, own slot) |
| Run matcher, apply proposal | Yes | Own missions | — |
| Submit | Yes | Own missions | — |
| Approve, reject | Yes, except own submissions | — | — |
| Respond to assignment | — | — | Own only |
| Audit log | Read | Own missions | — |

Permissions are declared in one policy module and checked by one middleware. A resource the caller may not see returns `404`, the same as one that does not exist. A resource they can see but may not act on returns `403`.

### Authentication

`POST /v1/auth/login` takes email and password and returns a signed token carrying user id, `org_id` and role. Every request runs inside one database transaction that first sets `app.org_id` from the token; row-level security policies compare each row's `org_id` to it. The API connects as a database role that does not own the tables, so the policies apply to it. Login is the only cross-tenant lookup and goes through one narrow, privileged function that finds a user by email.

## 6. The matching engine

### 6.1 Problem

A mission has slots: each requirement expands into `headcount` slots of (skill, minimum level). Choose at most one crew member per slot, and at most one slot per crew member, so that as many slots as possible are filled and the total quality is highest.

### 6.2 Hard constraints

A crew member is a candidate for a slot only if all hold:

1. Status is `active`.
2. Has the skill at or above the minimum level.
3. If `certified_until` is set, it is on or after the mission's last day.
4. No availability block overlaps the mission period.
5. No live assignment on another mission overlaps the period, widened by `min_rest_days` on each side.
6. Has not declined this mission.
7. Is not excluded by the lead for this run (`--exclude`).

Each failed check is recorded with its reason. That record is what makes the explanation possible.

### 6.3 Why not greedy

Slots: Pilot (level 3) and Medic (level 3). Crew: Ada is a level 5 pilot and a level 4 medic; Ben is a level 4 pilot only. Greedy fills Medic with Ada (the only medic), fine, but if it fills Pilot first it takes Ada, the best pilot, and Medic is left empty. The correct answer, Ben as pilot and Ada as medic, needs the two choices to be made together. The seed data includes this case.

### 6.4 Scoring

Each candidate and slot pair gets a score from 0 to 1, a weighted sum of components that are each 0 to 1:

| Component | Default weight | Definition |
|---|---|---|
| Proficiency | 0.45 | `level / 5` |
| Workload balance | 0.35 | `1 − (days assigned in the 90 days either side of the mission start ÷ 180)` |
| Rest | 0.20 | Days since the end of their previous mission, capped at 30, divided by 30 |

Weights are per-organisation settings. Each component is a small pure function with the same signature, held in a list. Adding a component, or a hard constraint such as a resource limit, means adding one function to a list.

### 6.5 Solving

Build a matrix of slots by crew with cost `1 − score`, or infinity where a hard constraint fails. Pad it with "leave unfilled" options that cost more than any real assignment, so the solver always fills as many slots as it can before optimising quality. Solve with the Hungarian algorithm. It is exact and cubic in the matrix size, which is instant for hundreds of crew.

Crew already `offered` or `accepted` on the mission are fixed in place; only open slots are solved. The lead can also fix someone with `--pin`.

Inputs are sorted by reference before solving, so the same data always gives the same result.

### 6.6 Output

A match run is saved and returned with:

- per slot: the chosen crew member, the score and its breakdown by component;
- per slot: up to three alternates, in score order;
- per unfilled slot: a count of candidates lost to each hard constraint, and the nearest miss ("Ada: level 3, needs 4");
- a summary: slots filled out of total.

`apply` turns a run into `proposed` assignments in one transaction. If the data has changed since the run, the exclusion constraint rejects the clash and the API tells the lead to rerun.

Known limit: constraints over the team as a whole, and optimising several missions together, do not fit the assignment model. They need an integer-programming solver. The matcher's interface (`match(input) → result`) is solver-agnostic, so that swap would not touch the API.

## 7. API

REST over JSON, prefix `/v1`. No organisation identifier appears in any path.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `GET /me` |
| Organisation | `GET /org`, `PATCH /org/settings` |
| Skills | `GET /skills`, `POST /skills` |
| Crew | `GET /crew`, `POST /crew`, `GET /crew/:ref`, `PATCH /crew/:ref`, `PUT /crew/:ref/skills/:skill`, `DELETE /crew/:ref/skills/:skill` |
| Availability | `GET /crew/:ref/availability`, `POST /crew/:ref/availability`, `DELETE /availability/:id` |
| Missions | `GET /missions`, `POST /missions`, `GET /missions/:ref`, `PATCH /missions/:ref`, `GET /missions/:ref/events` |
| Requirements | `POST /missions/:ref/requirements`, `DELETE /missions/:ref/requirements/:id` |
| Lifecycle | `POST /missions/:ref/{submit,withdraw,approve,reject,launch,complete,cancel}` |
| Matching | `POST /missions/:ref/match`, `GET /match-runs/:id`, `POST /match-runs/:id/apply` |
| Assignments | `GET /assignments` (own, for crew), `POST /assignments/:id/{accept,decline}`, `DELETE /assignments/:id` |

`:ref` accepts the human reference (`MSN-12`, `CRW-7`); crew members may use `me`.

Errors share one shape. `code` is stable and documented; `hint` is written for a person:

```json
{ "error": { "code": "SELF_APPROVAL_FORBIDDEN",
             "message": "You submitted MSN-12, so you cannot approve it.",
             "hint": "Ask another director to approve it." } }
```

Request and response schemas are defined once in the `contract` package and used by the API for validation and by the CLI for typing.

## 8. CLI

The binary is `mctl` (`mc` is already Midnight Commander and the MinIO client).

Principles:

- Commands are noun then verb, and mirror the API.
- Default output is a readable table or summary; `--json` on every command gives the raw API response.
- Colour and spinners only when writing to a terminal.
- Errors print the API's message and hint, then exit non-zero: `1` general, `2` usage, `3` not logged in, `4` forbidden, `5` not found, `6` conflict.
- Named profiles make role switching one flag: `--profile`, or `MCTL_PROFILE`.
- Destructive commands ask for confirmation unless `--yes` is given.
- After a successful command, print the likely next command.

The walk-through a reviewer should be able to run from the README:

```
mctl login --profile lead      # then --profile director, --profile crew
mctl whoami

mctl mission create --name "Europa Survey" --from 2027-03-01 --to 2027-03-20
mctl mission require MSN-4 --skill pilot --level 3
mctl mission require MSN-4 --skill medic --level 3 --count 2
mctl match run MSN-4                    # proposal with scores and reasons
mctl match apply RUN-9
mctl mission submit MSN-4

mctl mission approve MSN-4 --profile lead       # refused: not a director
mctl mission approve MSN-4 --profile director

mctl assignment list --profile crew
mctl assignment decline ASG-31 --reason "Medical leave" --profile crew
mctl match run MSN-4 --apply            # fills only the reopened slot
mctl mission launch MSN-4
mctl mission history MSN-4              # the audit trail
```

Other commands: `mctl crew list|show|add`, `mctl crew skill set`, `mctl availability add|list|remove`, `mctl skill list|add`, `mctl mission list|show|reject|cancel|complete`, `mctl org settings`.

`mctl match run` is the centrepiece and its output gets the most design attention: one row per slot with crew, score and component bars; alternates indented beneath; unfilled slots in a separate block with the reason counts and nearest miss.

## 9. Code structure

```
packages/
  contract/   Zod schemas and error codes shared by API and CLI
  matcher/    Pure functions. No database, no HTTP. Input in, result out.
  api/
    src/db/         schema, migrations, row-level security policies, seed
    src/auth/       token handling, policy module, permission middleware
    src/modules/    crew, skills, missions, assignments, matching — each: routes, service, repository
    src/missions/lifecycle.ts   the transition table
  cli/
    src/commands/   one file per noun
    src/output/     table, JSON and error rendering
docker-compose.yml  Postgres
```

Libraries: Hono (HTTP), Drizzle with `postgres` (data access and migrations), Zod (schemas), Commander (CLI), Vitest (tests). pnpm workspaces.

Rules for whoever writes the code, human or agent:

1. Route handlers do no data access; services do no HTTP.
2. Every database call goes through the request's transaction, which has the tenant set. There is no global database handle in module code.
3. Status changes happen only through `lifecycle.ts`.
4. The matcher package imports nothing from the API.
5. The CLI calls the API and formats output. Nothing else.
6. Any new table gets `org_id`, a composite foreign key, a row-level security policy, and an isolation test.

## 10. Verification

| What | How |
|---|---|
| Matcher correctness | Unit tests per constraint and scorer; the greedy-fails case; a property test comparing the solver with brute force on small random inputs; a determinism test |
| Tenant isolation | Integration tests against real Postgres: a user from organisation B requests every organisation A resource by reference and by id and gets `404`; a direct query with B's tenant set returns no A rows |
| Lifecycle | A table-driven test over every (status, transition, role) combination; self-approval refused for leads and directors; two-approval policy |
| Double booking | Two concurrent `apply` calls for the same crew member and overlapping periods: exactly one succeeds, the other gets `409` |
| CLI | The section 8 walk-through as a scripted end-to-end test against a seeded database, asserting exit codes and `--json` output |

Seed data: two organisations with different skill taxonomies and settings (one needs two approvals), around fifteen crew each, missions in several statuses, the greedy-fails case, and one mission that cannot be fully staffed so the unfilled-slot explanation is visible.

## 11. Build order

Each step ends with passing tests and a commit.

1. Workspace, Docker Postgres, schema, migrations, row-level security, seed.
2. Login, tenant-scoped transaction middleware, policy module, isolation tests.
3. Skills, crew and availability endpoints.
4. Missions, requirements and the lifecycle table.
5. Matcher package, in isolation, with its tests.
6. Match run and apply, assignments, accept and decline, exclusion constraint test.
7. CLI: login and profiles, then commands in walk-through order.
8. End-to-end script, README, seed polish.

If time runs short, cut in this order: two-approval policy, `--pin` and `--exclude`, organisation settings endpoints, alternates in the match output.

## 12. How the design extends

- **Resource constraints** (vehicles, equipment, budgets): a resource becomes another schedulable entity with the same exclusion-constraint pattern, and its limits become hard constraints in the matcher's list. Limits that span the team move the solver from assignment to integer programming behind the same interface.
- **Different approval workflows** (multi-stage, by mission size, delegated approvers): the policy settings grow into an ordered list of stages, each naming who may approve; `lifecycle.ts` and `mission_approvals` already record decisions individually.
- **Scale**: the matcher loads only crew who hold a required skill; if organisations reach thousands of crew, shortlist per slot before solving.

## 13. Open questions

1. Should a crew member see who else is on their mission? Current answer: no.
2. Should proposed assignments on old drafts expire? Current answer: not in this build.
3. Should a director be able to override a hard constraint with a recorded reason? Current answer: no; they remove the blocking record instead.
