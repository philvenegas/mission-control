# Mission Control — Design Document

Status: draft for review, written before implementation.
Audience: the engineering team, and the AI coding agent that will implement it.

## 1. What we are building

Mission Control lets a space organisation plan missions and staff them with the right crew. Today a mission lead cross-references skill profiles, calendars and existing commitments by hand. The product replaces that with a matcher that proposes a full crew, explains its reasoning, and never double-books anyone.

The deliverable is a multi-tenant HTTP API and a CLI (`mctl`) that exercises every primary workflow. There is no web interface.

### Scope of the first build

One vertical slice, end to end: a mission lead creates a mission, defines requirements, runs the matcher, applies the proposal and submits; a director approves; crew accept or decline; the lead fills any gap and launches the mission.

### Built, stretch, and designed only

The build target is five hours; running one to two hours over is acceptable. Section 11 gives the estimate per step.

- **Core (built):** everything in this document not listed below. Protected areas, built properly: the matcher and its explanation, the lifecycle with the self-approval rule, a proof of tenant isolation, and the CLI walk-through. Administration is thin: the skill taxonomy, organisation settings and users are seeded and read-only.
- **Stretch (built if time remains, in this order):** row-level security policies; `--pin` and `--exclude` on a match run. The core is built so that row-level security is purely additive (section 5).
- **Designed, not built:** organisation settings endpoints, the `withdraw` transition, the minimum rest gap between missions.

Text elsewhere marks these items as *(stretch)* or *(designed, not built)*.

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
| D3 | Tenant isolation in two layers: scoped data access with composite keys (core), plus row-level security (stretch) | "Data must never leak" should not depend on every query remembering a `WHERE` clause | Application-only filtering as the end state |
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
| D14 | The API exposes references only; internal ids never appear in a path, body or response | References are numbered per organisation, so another organisation's record cannot even be named | Global ids in the API |
| D15 | Email is unique within an organisation; login names the organisation | A globally unique email reveals that a user exists in another organisation | Globally unique email |

## 3. Domain model

Every table carries its own `org_id` column, including the child tables below whose key fields omit it for brevity (`crew_skills`, `availability_blocks`, `mission_requirements`, `assignments`, `mission_approvals`, `mission_events`, `match_runs`). One tenant rule then fits every table. Foreign keys between tenant tables are composite `(org_id, id)`, so a row can never reference another tenant's row even if application code is wrong.

| Table | Key fields | Notes |
|---|---|---|
| `organisations` | `id`, `name`, `slug`, `settings` | `settings`: `approvals_required` (default 1), `min_rest_days` (default 0; designed, not built), `match_weights`. Seeded; read-only in the core |
| `users` | `id`, `org_id`, `email`, `password_hash`, `name`, `role` | Unique on `(org_id, email)`. `role`: `director`, `mission_lead`, `crew_member` |
| `crew_members` | `id`, `org_id`, `ref`, `user_id` (nullable, unique), `name`, `status` | `status`: `active`, `inactive` |
| `skills` | `id`, `org_id`, `name`, `category` | Unique on `(org_id, name)` |
| `crew_skills` | `crew_member_id`, `skill_id`, `level` 1–5, `certified_until` (nullable) | Levels: 1 novice, 3 competent, 5 expert |
| `availability_blocks` | `id`, `crew_member_id`, `period` (daterange), `reason` | Crew are available unless a block says otherwise |
| `missions` | `id`, `org_id`, `ref`, `name`, `description`, `period` (daterange), `status`, `owner_id`, `submitted_by`, `submission_no` | `ref` is a per-organisation number shown as `MSN-12` |
| `mission_requirements` | `id`, `mission_id`, `skill_id`, `min_level`, `headcount` | Each unit of headcount is one slot |
| `assignments` | `id`, `mission_id`, `requirement_id`, `crew_member_id`, `period`, `status`, `score`, `decline_reason` | `period` is copied from the mission |
| `mission_approvals` | `id`, `mission_id`, `submission_no`, `approver_id`, `decision`, `note`, `created_at` | One row per decision. Unique on `(mission_id, submission_no, approver_id)` |
| `mission_events` | `id`, `mission_id`, `actor_id`, `type`, `from_status`, `to_status`, `note`, `created_at` | Append-only audit log |
| `match_runs` | `id`, `mission_id`, `created_by`, `result` (jsonb), `created_at` | The saved proposal and its explanation |

References. Five kinds of record have a reference, numbered per organisation and per kind, with a `ref` column unique on `(org_id, ref)`: mission `MSN`, crew member `CRW`, assignment `ASG`, match run `RUN`, availability block `AVL`. The next number for each kind is kept on the organisation row and taken inside the creating transaction. A skill is addressed by its name, a user by email, the organisation by its `slug` (globally unique). A requirement is addressed by its skill: `mission_requirements` is unique on `(mission_id, skill_id)`, so a mission has at most one requirement per skill. Two requirements for one skill at different levels is a later extension.

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
| `submit` | Owner (lead) or director | At least one requirement; period in the future; every slot has a proposed crew member; enough directors other than the submitter exist to meet `approvals_required` | Sets `submitted_by`; starts a new submission (`submission_no` + 1) |
| `withdraw` *(designed, not built)* | Submitter | — | Back to `draft` |
| `reject` | Director, not the submitter | Note required | Back to `draft`; assignments stay `proposed`. Approvals already given to this submission no longer count |
| `approve` | Director, not the submitter | Has not already approved this submission | Records approval. When the approval policy is met: status `approved`, assignments `proposed → offered`. Otherwise the mission stays `submitted` |
| `launch` | Owner or director | Every slot `accepted` | Status `active` |
| `complete` | Owner or director | — | Status `completed` |
| `cancel` | Owner or director; director only once `active` | Note required | Live assignments `→ released` |

### Approval policy

A **submission** is one trip of a mission through approval. Approvals belong to a submission, so a resubmitted mission starts again from zero: it could have been edited while back in `draft`.

Whether a submission is approved is decided by one pure function, `approvalState(policy, approvals) → pending | approved`. Today the policy is `{ approvals_required }` and the function counts approvals from distinct directors. A single rejection ends the submission. The policy is seeded per organisation; one seed organisation requires one approval and the other two.

Submit is refused when the organisation has fewer directors able to approve than the policy requires, the submitter excluded: "Artemis requires 2 approvals, but only 1 director other than you can approve." A mission never waits on an approval that cannot come.

`mctl mission approve` reports progress ("Approved (1 of 2). MSN-4 stays submitted until one more director approves."), and `mctl mission show` lists who has approved.

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
| Organisation settings, users | Read (seeded; managing them is designed, not built) | — | — |
| Skills taxonomy | Read (seeded) | Read | Read |
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

`POST /v1/auth/login` takes the organisation's slug, an email and a password, and returns a signed token carrying user id, `org_id` and role. Login is the only cross-tenant lookup and goes through one narrow, privileged function that finds a user by slug and email. Every failure gives the same answer, "invalid organisation, email or password", so login does not reveal which organisations or emails exist.

### Keeping a request inside its organisation

- Every repository function takes a tenant context (the request's transaction and `org_id`) and filters by `org_id` explicitly. There is no other way to reach the database from module code.
- Paths and bodies carry references, which resolve only within the caller's organisation (D14).
- Errors are thrown as typed domain errors, never returned. One error handler turns them into responses. Any throw rolls the request's transaction back; as a backstop, so does any response with status 400 or above.

The core is built ready for row-level security, so adding it later changes no existing code:

- Every table has `org_id`.
- The API connects as a separate database role that does not own the tables and cannot bypass policies. Migrations and the seed run as the owner.
- Every request runs inside one database transaction that first sets `app.org_id` from the token, with `set_config('app.org_id', <id>, true)` so the setting ends with the transaction.

In the core, repositories filter by that `org_id` and composite foreign keys reject cross-tenant references. The stretch step adds one policy per table comparing the row's `org_id` to `app.org_id`, plus a test that the API's role is neither a superuser nor able to bypass policies. Setup steps and pitfalls are in the research note `research/rls-with-drizzle.md` on the `research/rls-with-drizzle` branch.

## 6. The matching engine

### 6.1 Problem

A mission has slots: each requirement expands into `headcount` slots of (skill, minimum level). Choose at most one crew member per slot, and at most one slot per crew member, so that as many slots as possible are filled and the total quality is highest.

### 6.2 Hard constraints

A crew member is a candidate for a slot only if all hold:

1. Status is `active`.
2. Has the skill at or above the minimum level.
3. If `certified_until` is set, it is on or after the mission's last day.
4. No availability block overlaps the mission period.
5. No live assignment on another mission overlaps the period. Widening the period by `min_rest_days` on each side is designed, not built.
6. Has not declined this mission.
7. Is not excluded by the lead for this run (`--exclude`) *(stretch)*.

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

Solve with a hand-written Hungarian algorithm (shortest-augmenting-path form, about 50 lines). It is exact and cubic in the matrix size, which is instant for hundreds of crew. No library is used: none treats a forbidden pair as forbidden, and none promises which of several equal answers it returns.

For `S` slots and `C` crew, build an `S × (C + S)` matrix of whole-number costs:

- an allowed pair costs `round((1 − score) × 1,000,000)`;
- each slot has its own "unfilled" column costing `UNFILLED = S × 1,000,000 + 1`, more than any sum of real costs, so filling one more slot always wins over quality;
- a forbidden pair, and any other slot's "unfilled" column, costs `2 × UNFILLED`.

A slot whose answer is a column at or beyond `C` is unfilled. Infinity is never passed to the solver.

Crew already `offered` or `accepted` on the mission are fixed in place; only open slots are solved. The lead can also fix someone with `--pin` *(stretch)*.

Slots and crew are sorted by reference before the matrix is built, costs are whole numbers, and comparisons are strict, so the same data always gives the same result.

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
| Organisation | `GET /org`; `PATCH /org/settings` *(designed, not built)* |
| Skills | `GET /skills` (the taxonomy is seeded) |
| Crew | `GET /crew`, `POST /crew`, `GET /crew/:ref`, `PATCH /crew/:ref`, `PUT /crew/:ref/skills/:skill`, `DELETE /crew/:ref/skills/:skill` |
| Availability | `GET /crew/:ref/availability`, `POST /crew/:ref/availability`, `DELETE /availability/:ref` |
| Missions | `GET /missions`, `POST /missions`, `GET /missions/:ref`, `PATCH /missions/:ref`, `GET /missions/:ref/events` |
| Requirements | `PUT /missions/:ref/requirements/:skill`, `DELETE /missions/:ref/requirements/:skill` |
| Lifecycle | `POST /missions/:ref/{submit,approve,reject,launch,complete,cancel}`; `withdraw` *(designed, not built)* |
| Matching | `POST /missions/:ref/match`, `GET /match-runs/:ref`, `POST /match-runs/:ref/apply` |
| Assignments | `GET /assignments` (own, for crew), `POST /assignments/:ref/{accept,decline}`, `DELETE /assignments/:ref` |

`:ref` is the record's reference (`MSN-12`, `CRW-7`, `ASG-31`, `RUN-9`, `AVL-3`); crew members may use `me` for their own crew record. `:skill` is the skill's name. Internal ids appear nowhere in the API.

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
mctl login --org artemis --email lead@artemis.example --profile lead
                               # then --profile director, --profile crew
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

Other commands: `mctl crew list|show|add`, `mctl crew skill set`, `mctl availability add|list|remove`, `mctl skill list`, `mctl mission list|show|unrequire|reject|cancel|complete`, `mctl org show`.

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
6. Any new table gets `org_id`, a composite foreign key and, once the stretch step is done, a row-level security policy. Any new route is added to the isolation sweep; the coverage test fails until it is.
7. Errors are thrown, never returned.
8. Requests and responses carry references, never internal ids.

## 10. Verification

| What | How |
|---|---|
| Matcher correctness | Unit tests per constraint and scorer; the greedy-fails case; a property test comparing the solver with brute force on small random inputs; a determinism test |
| Tenant isolation | Integration tests against real Postgres. (1) A sweep: a user from organisation B calls every route; lists contain no organisation A rows, and references that exist only in A give `404`. (2) A coverage test that fails when a registered route is missing from the sweep. (3) A direct database test that a row linking to another organisation's row is rejected by the composite foreign key. (4) A response with status 400 or above leaves no writes behind. With the stretch step: a direct query with B's tenant set returns no A rows, and the API's database role cannot bypass policies |
| Lifecycle | A table-driven test over every (status, transition, role) combination; self-approval refused for leads and directors; `approvalState` unit tests; with two approvals required: one approval leaves the mission `submitted`, the same director cannot approve twice, a rejection voids the earlier approval, and submit is refused when too few directors can approve |
| Double booking | Two concurrent `apply` calls for the same crew member and overlapping periods: exactly one succeeds, the other gets `409` |
| CLI | The section 8 walk-through as a scripted end-to-end test against a seeded database, asserting exit codes and `--json` output |

Seed data: two organisations with different skill taxonomies and settings (one needs two approvals), around fifteen crew each, missions in several statuses, the greedy-fails case, and one mission that cannot be fully staffed so the unfilled-slot explanation is visible.

## 11. Build order

Each step ends with passing tests and a commit. Estimates are in minutes, working with a coding agent, and include the step's tests from section 10; all five kinds of test in that section are part of the core.

| Step | Minutes |
|---|---|
| 1. Workspace, Docker Postgres, owner and API database roles, schema with `org_id` on every table, migrations, seed | 45 |
| 2. Login, tenant-scoped transaction middleware, policy module, isolation tests | 50 |
| 3. Skill list; crew add, show, list, set skill; availability add, list, remove | 15 |
| 4. Missions, requirements and the lifecycle table | 35 |
| 5. Matcher package, in isolation, with its tests | 40 |
| 6. Match run and apply, assignments, accept and decline, double-booking test | 30 |
| 7. CLI: login and profiles, then commands in walk-through order | 40 |
| 8. End-to-end script, README, seed polish | 30 |
| **Core** | **285** |

Stretch, in order, if time remains: row-level security policies (60–90), then `--pin` and `--exclude` (15).

## 12. How the design extends

- **Resource constraints** (vehicles, equipment, budgets): a resource becomes another schedulable entity with the same exclusion-constraint pattern, and its limits become hard constraints in the matcher's list. Limits that span the team move the solver from assignment to integer programming behind the same interface.
- **Different approval workflows** (multi-stage, by mission size, delegated approvers): the policy grows from a single number into an ordered list of stages, each naming who may approve, and only `approvalState` changes; `mission_approvals` already records each decision against its submission.
- **Scale**: the matcher loads only crew who hold a required skill; if organisations reach thousands of crew, shortlist per slot before solving.

## 13. Open questions

1. Should a crew member see who else is on their mission? Current answer: no.
2. Should proposed assignments on old drafts expire? Current answer: not in this build.
3. Should a director be able to override a hard constraint with a recorded reason? Current answer: no; they remove the blocking record instead.
