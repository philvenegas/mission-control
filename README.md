# Mission Control

Mission Control lets a space organisation plan missions and staff them with the right crew.
A mission lead says what a mission needs; the matcher proposes a full crew and explains every choice and every exclusion, and never puts anyone on two missions at once; a director approves, and crew accept or decline.
It is a multi-tenant HTTP API and a CLI, `mctl`, that exercises every workflow; each organisation sees only its own data.

## Setup

Prerequisites: Docker, Node 22.18 or later, and pnpm. Postgres runs in Docker; the API and the CLI run on your machine.

```sh
pnpm install
pnpm demo:setup                  # start Postgres, migrate, seed, build; says what each step did
pnpm api                         # the API, in a terminal of its own
export PATH="$PWD/bin:$PATH"     # makes `mctl` runnable; nothing is installed outside the repository
pnpm demo:login                  # six demo profiles
mctl status
```

- `pnpm demo:setup` copies `.env.example` to `.env`, and can be run again safely. Postgres is published on host port 54329, so it cannot collide with a Postgres you already run; the API listens on 3000 (`PORT` in `.env` changes it).
- `pnpm demo:login` logs in as six seeded users, one profile each: `lead` (Sam Okafor, a mission lead, current), `director` (Dana Okoye), the crew members `ada`, `quin` and `mina`, and `helios` (Farid Rahimi, a mission lead at Helios Labs). Every seeded user's password is `mission-control-demo`.
- `pnpm demo:reset` reseeds, returning the walk-through to a clean state. Run `pnpm demo:login` after it.
- `make` lists the same commands as Makefile targets.

## Walk-through

Three short acts, from a clean state: with the API running, run `pnpm demo:reset` and `pnpm demo:login`, then the commands below. What each prints is copied from a real run; only the times will differ. This section is also a test: `packages/cli/src/readme.int.test.ts` runs every command in it, twice, and fails if one exits or prints differently.

### Act 1: plan to launch

A two-slot mission, so that few crew logins are needed. Sam, a mission lead, creates it, runs the matcher, applies its proposal and submits; Dana, a director, approves; Quin declines; the matcher fills the reopened slot; the crew accept and Sam launches.

```console
$ mctl login --org artemis --email sam@artemis.example --profile lead   # the real flow, once, by hand
Password:
as Sam Okafor · mission lead · Artemis
Logged in to Artemis as Sam Okafor. Saved as profile "lead", the current one.
The login expires at 2026-10-10 09:52 UTC.
Next: mctl whoami

$ mctl whoami
as Sam Okafor · mission lead · Artemis
Sam Okafor <sam@artemis.example>
Sam Okafor · mission lead · Artemis
Profile "lead" at http://localhost:3000; the login expires at 2026-10-10 09:52 UTC.

$ mctl profile list
as Sam Okafor · mission lead · Artemis
  ada       Ada Reyes · crew member · Artemis  ada@artemis.example  expires 2026-10-10 09:52 UTC
  director  Dana Okoye · director · Artemis  dana@artemis.example  expires 2026-10-10 09:52 UTC
  helios    Farid Rahimi · mission lead · Helios Labs  farid@helios.example  expires 2026-10-10 09:52 UTC
* lead      Sam Okafor · mission lead · Artemis  sam@artemis.example  expires 2026-10-10 09:52 UTC
  mina      Mina Farouk · crew member · Artemis  mina@artemis.example  expires 2026-10-10 09:52 UTC
  quin      Quin Abara · crew member · Artemis  quin@artemis.example  expires 2026-10-10 09:52 UTC

$ mctl mission create --name "Europa Survey" --from 2027-03-01 --to 2027-03-20
as Sam Okafor · mission lead · Artemis
Created MSN-8 Europa Survey, 1–20 Mar 2027, as a draft.
Next: mctl mission require MSN-8 --skill <skill> --level <level>

$ mctl mission require MSN-8 --skill pilot --level 3
as Sam Okafor · mission lead · Artemis
MSN-8 needs 1 crew member with pilot at level 3 or above.
Next: mctl match run MSN-8

$ mctl mission require MSN-8 --skill medic --level 3
as Sam Okafor · mission lead · Artemis
MSN-8 needs 1 crew member with medic at level 3 or above.
Next: mctl match run MSN-8

$ mctl match run MSN-8                     # the proposal, with reasons; nothing changes yet
as Sam Okafor · mission lead · Artemis
MSN-8  Europa Survey  1–20 Mar 2027
✓ 2 of 2 slots filled

medic  level 3 or above
  → Quin Abara CRW-7   score 82
    level 3 (27 of 45) · 0 of 180 days assigned (35 of 35) · never flown (20 of 20)
    alternates: Ada Reyes 87 (chosen for pilot), Mina Farouk 65, Kira Novak 61

pilot  level 3 or above
  → Ada Reyes CRW-1   score 91
    level 5 (36 of 45) · 0 of 180 days assigned (35 of 35) · never flown (20 of 20)
    alternates: Ben Osei 65, Cy Lindqvist 61

Excluded with the skill:
  CRW-4 Noor Haddad — medic certification expires 10 Mar, before the mission ends
  CRW-5 Omar Vance — availability block AVL-1, 5–12 Mar

Saved as RUN-1. Nothing has changed yet.
  Apply it:      mctl match apply RUN-1
  Pick another:  mctl assignment add MSN-8 --crew CRW-3 --skill medic

$ mctl match apply RUN-1
as Sam Okafor · mission lead · Artemis
Applied RUN-1. MSN-8 has 2 of 2 slots filled.
  medic: Quin Abara CRW-7, proposed (ASG-14)
  pilot: Ada Reyes CRW-1, proposed (ASG-15)
Next: mctl mission submit MSN-8

$ mctl mission submit MSN-8
as Sam Okafor · mission lead · Artemis
Submitted MSN-8 for approval; its crew are held.
Next (a director): mctl mission approve MSN-8

$ mctl mission approve MSN-8               # refused with exit code 4: a mission lead cannot approve
as Sam Okafor · mission lead · Artemis
Error: Your role does not allow this.

$ mctl mission approve MSN-8 --profile director
as Dana Okoye · director · Artemis
Approved MSN-8. Its crew are offered their places.
Next: mctl mission show MSN-8

$ mctl assignment list --profile quin      # the medic sees the offer
as Quin Abara · crew member · Artemis
ASG-14  MSN-8 Europa Survey  1–20 Mar 2027  medic  offered
Next: mctl assignment accept ASG-14

$ mctl assignment decline ASG-14 --reason "Medical leave" --profile quin
as Quin Abara · crew member · Artemis
Declined ASG-14: medic on MSN-8 Europa Survey.
Next: mctl assignment list

$ mctl match run MSN-8 --apply             # fills only the reopened slot
as Sam Okafor · mission lead · Artemis
MSN-8  Europa Survey  1–20 Mar 2027
✓ 2 of 2 slots filled

medic  level 3 or above
  → Mina Farouk CRW-3   score 65
    level 4 (32 of 45) · 71 of 180 days assigned (21 of 35) · 19 days rested (13 of 20)
    alternates: Kira Novak 61

Excluded with the skill:
  CRW-4 Noor Haddad — medic certification expires 10 Mar, before the mission ends
  CRW-5 Omar Vance — availability block AVL-1, 5–12 Mar
  CRW-7 Quin Abara — declined MSN-8

Applied RUN-2. MSN-8 has 2 of 2 slots filled.
  medic: Mina Farouk CRW-3, offered (ASG-16)

$ mctl assignment accept ASG-15 --profile ada
as Ada Reyes · crew member · Artemis
Accepted ASG-15: pilot on MSN-8 Europa Survey, 1–20 Mar 2027.
Next: mctl mission show MSN-8

$ mctl assignment accept ASG-16 --profile mina
as Mina Farouk · crew member · Artemis
Accepted ASG-16: medic on MSN-8 Europa Survey, 1–20 Mar 2027.
Next: mctl mission show MSN-8

$ mctl mission launch MSN-8
as Sam Okafor · mission lead · Artemis
Launched MSN-8; it is active.
Next: mctl mission complete MSN-8

$ mctl mission history MSN-8               # who did what, and when
as Sam Okafor · mission lead · Artemis
2026-10-03 09:52 UTC  submit   draft → submitted     Sam Okafor
2026-10-03 09:52 UTC  approve  submitted → approved  Dana Okoye
2026-10-03 09:52 UTC  launch   approved → active     Sam Okafor
```

Mina is the stronger medic, yet the matcher first chose Quin: Mina's time on Lunar Gateway Resupply, which ends 19 days before Europa Survey, costs her more in workload and rest than her extra level earns. That is the fairness trade-off of `DESIGN.md` section 6.4, on real data.

### Act 2: a clash

Two seeded drafts overlap and want the same pilot: Sam's Ceres Resupply and Priya Nair's Vesta Mapping. Neither can be submitted until one lets Ada go.

```console
$ mctl mission show MSN-4
as Sam Okafor · mission lead · Artemis
MSN-4  Ceres Resupply  3–24 May 2027
draft · owner Sam Okafor
Supplies for the Ceres outpost.

2 of 2 slots filled
engineer  level 4 or above
  1 of 1  ASG-11  Noor Haddad CRW-4            proposed  chosen by Sam Okafor
pilot  level 3 or above
  1 of 1  ASG-10  Ada Reyes CRW-1              proposed  chosen by Sam Okafor  ✗ clash: also proposed on MSN-5 Vesta Mapping (draft, owner Priya Nair)
Next: mctl assignment remove ASG-10

$ mctl mission submit MSN-4                # refused with exit code 6, naming the clash
as Sam Okafor · mission lead · Artemis
Error: MSN-4 cannot be submitted: Ada Reyes CRW-1 is also proposed on MSN-5 Vesta Mapping (draft, Priya Nair).
  Each problem must be resolved first: release the crew member, or change what blocks them.

$ mctl assignment remove ASG-10 --yes      # let her go; without --yes it asks first
as Sam Okafor · mission lead · Artemis
Released ASG-10 from MSN-4.
Next: mctl match run MSN-4

$ mctl match run MSN-4 --apply
as Sam Okafor · mission lead · Artemis
MSN-4  Ceres Resupply  3–24 May 2027
✓ 2 of 2 slots filled

pilot  level 3 or above
  → Ben Osei CRW-2   score 85
    level 4 (32 of 45) · 8 of 180 days assigned (33 of 35) · 82 days rested (20 of 20)
    alternates: Ada Reyes 87 (clash with MSN-5), Cy Lindqvist 80

Applied RUN-3. MSN-4 has 2 of 2 slots filled.
  pilot: Ben Osei CRW-2, proposed (ASG-17)
Next: mctl mission submit MSN-4

$ mctl mission submit MSN-4                # succeeds
as Sam Okafor · mission lead · Artemis
Submitted MSN-4 for approval; its crew are held.
Next (a director): mctl mission approve MSN-4
```

Ada scores higher than Ben, but the matcher passes her over: a clash-free full crew exists, so it makes none.

### Act 3: another organisation sees nothing

Farid Rahimi is a mission lead at Helios Labs. References resolve inside the caller's organisation, so Artemis's MSN-8 does not exist for him.

```console
$ mctl mission show MSN-8 --profile helios   # not found, exit code 5: MSN-8 is Artemis's
as Farid Rahimi · mission lead · Helios Labs
Error: MSN-8 was not found.

$ mctl mission list --profile helios         # only Helios's missions
as Farid Rahimi · mission lead · Helios Labs
MSN-1  Solar Corona Probe  1–28 Feb 2027  submitted  Farid Rahimi  2 of 2 filled
MSN-2  Mercury Flyby       5–26 Apr 2027  draft      Farid Rahimi  2 of 3 filled

$ mctl crew list --profile helios            # only Helios's crew, with its own skill names
as Farid Rahimi · mission lead · Helios Labs
CRW-1  Anouk Petit   active  EVA 3; flight operations 5
CRW-2  Bao Tran      active  flight operations 3; robotics 4
CRW-3  Carmen Ruiz   active  field medicine 5
CRW-4  Dev Malhotra  active  robotics 5; spectroscopy 3
CRW-5  Elif Kaya     active  spectroscopy 5
CRW-6  Finn Larsen   active  EVA 4; field medicine 3
CRW-7  Grace Mbeki   active  EVA 4; robotics 3
CRW-8  Hiro Tanaka   active  flight operations 2; spectroscopy 4
```

Every command takes `--json` for the API's raw answer, and `mctl --help` lists the rest: `crew list|show|add`, `crew skill set`, `availability add|list|remove`, `skill list`, `status`, `profile list|use`, `logout`, `mission list|show|unrequire|reject|cancel|complete`, `assignment add|remove|clear`, `match show`, `org show`. Seeded drafts worth a look: `mctl match run MSN-6` explains an unfilled slot, and `mctl match run MSN-7` shows why filling slot by slot would fail.

Exit codes: `1` general, or the API cannot be reached; `2` usage or invalid input; `3` not logged in; `4` forbidden; `5` not found; `6` conflict, including a refused transition.

## Tests

```sh
pnpm test            # unit tests; no database needed
pnpm test:int        # integration and end-to-end tests, against a separate test database
pnpm test:coverage   # both, with every file's uncovered lines
pnpm lint            # lint, unused exports, files and dependencies, and words the glossary avoids
pnpm build           # typecheck every package
```

`pnpm test:int` needs Postgres, which `pnpm demo:setup` starts; it uses its own database, so the demo data is untouched. CI runs all of them on every pull request.

Paths are under `packages/api/src` unless they name another package.

| Kind | Where | What it proves |
|---|---|---|
| Matcher | `packages/matcher`, unit | Each hard constraint and scorer; the case where filling slot by slot fails; a property test comparing the solver with brute force on small random inputs; the same input always gives the same result; the package imports nothing from the API |
| Tenant isolation | `http/isolation.int.test.ts`, `http/tenant.int.test.ts`, `db/schema.int.test.ts`, `db/row-level-security.int.test.ts` | A user of one organisation calls every route and finds nothing of the other: lists hold none of its rows, its references answer 404, and no response carries an internal id. A coverage test fails when a route is missing from that sweep. The database refuses a row that links to another organisation's row, and a refused request leaves no writes. Under row-level security, a direct query as the API role sees only the organisation it has set, and nothing with none set, in every table; the role is not a superuser and cannot bypass the policies, and a table without a forced policy fails the test |
| Lifecycle | `modules/missions/lifecycle.int.test.ts`, `modules/missions/approval.test.ts` | Every transition from every status by every role; nobody approves what they submitted; the approval policy with one and with two approvals required |
| Double booking | `modules/matching/clashes.int.test.ts`, `db/schema.int.test.ts` | Two transactions taking a hold on one crew member at once: exactly one succeeds. The booking rule holds in the database whatever the application does |
| Proposals, clashes and holds | `modules/matching/clashes.int.test.ts` | All seventeen scenarios of `DESIGN.md` section 10, numbered to match |
| Seed | `db/seed.int.test.ts`, `modules/matching/seed.int.test.ts` | The seed is sound, and the matcher gives the outcomes the walk-through relies on |
| API | the other `*.int.test.ts` under `packages/api` | Each endpoint against real Postgres: answers, refusals and their codes, and locks that hold, each tested by holding the lock |
| CLI | `packages/cli`, unit and integration | Output formats, profiles and prompts; every command against the real API as a separate process, and `--json` gives only JSON |
| End to end | `packages/cli/src/walkthrough.int.test.ts`, `packages/cli/src/readme.int.test.ts` | The three acts through `mctl`, asserting exit codes and `--json` answers; and this README's walk-through, run as written twice, after `pnpm demo:reset` each time |
| Code rules | `architecture.test.ts`, `glossary.test.ts`, `packages/matcher/src/architecture.test.ts` | Modules reach the database only through the request's transaction, services and repositories import no HTTP, and status changes only through the lifecycle; the code uses no word `CONTEXT.md` avoids |

## What is built

| | Item | State |
|---|---|---|
| Core | Multi-tenant API: login, tenant-scoped transactions, roles and the policy module | Built |
| Core | Crew, skills and availability; the skill taxonomy, organisation settings and users seeded and read-only | Built |
| Core | Missions, requirements and the lifecycle table, with the self-approval rule and the approval policy | Built |
| Core | The matcher and its explanation; match runs, applying them, hand assignment, the proposal check, clashes and holds | Built |
| Core | Accept and decline, and refilling a declined slot | Built |
| Core | The CLI, `mctl`, with profiles and every primary workflow | Built |
| Core | The tests of `DESIGN.md` section 10, the end-to-end walk-through, and the seed | Built |
| Stretch | Row-level security policies | Built |
| Stretch | `--pin` and `--exclude` on a match run | Not built yet ([#26](https://github.com/philvenegas/mission-control/issues/26)) |
| Designed only | Organisation settings endpoints | Designed, not built: settings are seeded, and `mctl org show` reads them |
| Designed only | The `withdraw` transition | Designed, not built |
| Designed only | A minimum rest gap between missions | Designed, not built: rest is scored, not required |

## Where the build diverged from the design

Each entry was added when the divergence happened, with its reason. `DESIGN.md` is not edited.

- **Ben Osei is also on Lunar Gateway Resupply** (seed, design section 10). The design lists Kira, Leo, Cy and Mina. With Ben free, the Europa Survey walk-through has two crews of exactly equal total score (Ada as pilot with Quin as medic, or Ben as pilot with Ada as medic: 91 + 82 against 86.5 + 86.5), so the required outcome would rest on a tie-break. Ben's recent workload makes Ada and Quin the clear answer. The mission now needs two pilots.
- **Seeded periods are stored exactly as the design writes them, with the end exclusive.** "1–20 Mar 2027" is stored as `[2027-03-01, 2027-03-20)`, following the glossary's definition of a period. This keeps Mina's rest before Europa Survey at the 19 days the design states.
- **Each package is created by the step that fills it** (build step 1, design sections 9 and 11). Step 1 lists all four packages, but the project rules forbid placeholder code: the matcher arrived in step 5, and the CLI comes in step 7.
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
- **Each row of the transition table names the permission it needs, not a list of roles** (design section 4, `{ from, to, roles, guard, effect }`). Who holds a permission, and whether only for their own missions, is declared once in the policy module; the table points at it. `cancel` is therefore two rows: the owner or a director before the mission is under way, a director only once it is `active`. Rows carry two fields the design does not list: `needsNote` (reject and cancel need a reason) and `decide` (below). The table, and the one function that makes a transition by it, are in `modules/missions/lifecycle.ts`, beside the rest of the missions module, rather than `src/missions/lifecycle.ts`.
- **A transition can decide to leave the mission where it is.** Approval records the director's decision, then changes the status only when the approval policy is met. Every approval writes a history event, including one that leaves the mission `submitted` (its event goes from `submitted` to `submitted`), so the history shows each director's approval. A rejection is recorded as a decision too, ending the submission.
- **A transition locks the mission's row first,** as well as changing the status with `UPDATE ... WHERE status = <expected>`. Without the lock, two directors approving at the same moment would each count only their own approval, and a mission needing two would stay `submitted` with both. With it, the conditional update is a second line of defence that no test can reach.
- **Refusals have their own codes** (design section 7 documents `SELF_APPROVAL_FORBIDDEN` only): `TRANSITION_NOT_ALLOWED` (409) when the mission's status does not allow the transition, `GUARD_FAILED` (409) when a guard does not hold, `NOT_DRAFT` (409) for a change to a mission that is no longer a draft, and `REQUIREMENT_STAFFED` (409), below. A role that may never make a transition gets 403 at once; otherwise a status that does not allow it gets 409 before the caller's ownership is checked, and an owner-only permission on someone else's mission gets 403.
- **"Period in the future" means the mission starts after today** (UTC), so a mission starting today cannot be submitted.
- **A requirement cannot be removed while crew are proposed for it, nor its headcount cut below their number** (`REQUIREMENT_STAFFED`). The design leaves this open; removing proposals silently would lose the mission lead's plan.
- **What a mission response carries** (the design leaves it open): its owner and submitter by name and email, its requirements, and `approval`: how many approvals the organisation requires and who has approved the current submission (nobody while the mission is a draft). A crew member sees a reduced shape, the mission's reference, name, period and their own slot (assignment reference, skill, status), and only for missions they are offered or accepted on.
- **Reject and cancel need a note; the other transitions take one optionally.** A mission's description is optional and at most 2,000 characters; notes are at most 500. A change of period gives both `from` and `to`.
- **The matcher has a seventh hard constraint: a crew member already in one of the mission's slots is not a candidate for another** (design section 6.2). Section 6.1 says each crew member fills one slot at most; with only the open slots solved, someone already proposed, held, offered or accepted on the mission would otherwise be offered a second slot. The design's own seventh, excluding crew for one run, is a stretch and not built.
- **Match weights are taken as shares of their sum,** so a score stays between 0 and 1 whatever scale an organisation sets. The contract now refuses a negative weight, and weights that are all zero (design section 6.4 gives only defaults).
- **The matcher returns data, not sentences** (design section 6.6). Each failure is the constraint that failed and what failed it (the level held and needed, the availability block, the other mission); the CLI puts it into words, as invariant 9 has it. Crew "excluded with the skill" are called `ruledOut` in the code, since the glossary keeps *exclude* for a mission lead keeping someone out of a run. Crew already placed on the mission are not among them.
- **How an unfilled slot is explained** (design section 6.6 leaves it open). Each crew member is counted once, against the first constraint they fail in the list's order, with "has no such skill" and "below the level" counted apart and "chosen for another slot" for a candidate the run placed elsewhere. The nearest misses are crew who hold the skill, fewest failures first, then fewest levels short, then by reference.
- **Requirements are ordered by skill name before solving** (design section 6.5 sorts "slots and crew by reference number"). A slot has no reference; within a requirement, the open slots are numbered after those already filled, and the filled ones come first, best score first.
- **The matcher is told the mission's status, and sees a clash only on a draft.** The glossary defines a clash as two drafts proposing the same crew member; when an approved mission refills a slot (design section 10, scenario 12), a proposal on another draft does not hold the crew member back, and that draft shows the problem instead.
- **A match run weighs every crew member of the organisation,** not only those holding a required skill (the issue's wording). The design's unfilled-slot output (section 8) counts crew who lack the skill ("9 do not have geologist"), which needs them weighed too. This also departs from section 12 ("Scale: the matcher loads only crew who hold a required skill"); at the hundreds of crew the design expects the cost is small, and shortlisting per slot remains the answer at thousands. Crew "excluded with the skill" are still only those who hold it.
- **The matcher exports `assessCandidate`,** which weighs one crew member for one slot: the hard constraints they fail, the clashes they would make, and their score. The matcher uses it for every pair, and the API uses it for a hand assignment and to check a run again before applying it, so all three give the same reasons and the same score (design section 4, "Hand assignment").
- **Running the matcher, applying a run, assigning by hand and releasing crew happen only on a draft or an approved mission** (`NOT_STAFFABLE`, 409). The design names those two as the statuses whose crew change: a draft plans, an approved mission refills a declined or open slot. Each locks the mission while it changes its crew.
- **Applying a run checks more than the hard constraints** (design section 6.6). It also checks that the mission still needs each skill the run filled, and still has the slot open, since a draft can change after its run. Every problem is named in one refusal (`RUN_OUT_OF_DATE`). A clash is checked against the data as it is when applying, not as it was when the run was made, and a run read again under the mission's lock is seen as applied if another request has just applied it; `allow_clashes: true` in the body is the API's form of the CLI's `--yes` (`CLASH_NOT_ALLOWED` without it). An applied assignment records the score the run showed; a hand assignment records the score the matcher would give.
- **One permission covers the matcher and hand assignment,** `missions:assign-crew`: the design's single row "Run matcher, apply a run, assign by hand, see a match run" (section 5), with releasing and clearing crew added. A mission lead naming another lead's mission is refused with 403, since they can see the mission; another lead's match run answers 404, since they cannot see it.
- **Removing an assignment releases it** rather than deleting the row, which keeps it in the record. A declined assignment cannot be released (`WRONG_ASSIGNMENT_STATUS`): it is what keeps the crew member who said no out of the matcher for that mission. Removing one returns the mission, as do the other crew changes.
- **A mission's response lists the crew in each requirement** (the design leaves the shape open): the assignment's reference, the crew member, status, score, the match run that chose them (null when assigned by hand or seeded) and who assigned them, and a decline's reason. Released assignments are not listed. Seeded assignments have no score.
- **Responding** (design sections 4 and 7). A crew member accepts or declines only their own offered assignment; one that is not theirs, or that they cannot see (proposed or held), answers 404, and one already answered is refused with `WRONG_ASSIGNMENT_STATUS`. A decline may give a reason of up to 500 characters. `GET /v1/assignments` lists their offered and accepted assignments, so a declined one leaves the list.
- **New error codes:** `NOT_STAFFABLE`, `NO_OPEN_SLOT`, `HARD_CONSTRAINT_FAILED`, `RUN_ALREADY_APPLIED`, `RUN_OUT_OF_DATE`, `CLASH_NOT_ALLOWED` and `WRONG_ASSIGNMENT_STATUS`, all 409. A refusal over a hard constraint names each one in words; a match run gives the same reasons as data.
- **The isolation sweep calls the crew-only routes as a crew member** (`GET /v1/assignments`, accept and decline). Helios Labs seeds no crew logins, so the sweep gives Bao Tran one for its run.
- **Problems are shown on each proposed crew member** (design section 4, "Proposal check"): a mission's response gives every crew member in its slots a list of `problems`, as data, worked out when it is read. A problem is a clash, naming the other draft, its status and owner, or a hard constraint the crew member now fails (held elsewhere, an availability block, an expired certification, a lower level, inactive). Clashes come first. Only a proposal can have a problem; held and later crew show none. Each proposal is weighed as if it were not there, since it is the one being checked.
- **The clash event** (design section 4): when a proposal makes a clash, each other draft involved gets a `clash` event with no status change, whose actor is the user who made the proposal and whose note names the mission and the crew member ("Ada Reyes CRW-1 is now also proposed on MSN-9 Pallas Flyby."). Only a proposal writes one, as the design says: a draft whose period is moved into another's makes a clash that shows when either is read, but no event.
- **A refused submit names every problem in one message** (`GUARD_FAILED`), after the earlier guards. Unfilled slots are a separate refusal, checked after the problems, giving each requirement's fill count ("pilot has 1 of 2 slots filled") and saying the organisation does not allow open slots.
- **An availability block over a live assignment is refused with `CREW_HELD`** (409). An offered or accepted assignment is named with its mission and period. A held one is never named, whoever adds the block, so that a crew member is not told of a mission awaiting approval.
- **The booking rule's refusal is `CREW_HELD` too.** When two requests take a hold on one crew member at once and the database's exclusion constraint refuses the second, the one error handler turns it into 409 rather than an internal error.
- **The match endpoint needs no extra step to see clashes** (issue "Proposal check, clashes and holds"): the matcher is already given every assignment of every crew member, proposals on other drafts included, so it avoids a clash whenever a clash-free crew exists and flags one it cannot avoid.
- **A decision that rests on what a crew member can do locks their row** (beyond design section 4, which locks only by status). Submitting a mission, placing crew in a slot by hand or from a run, adding an availability block, and changing a crew member's status or skills each lock the crew members involved, in id order, so a block added while a mission is submitted cannot leave a submitted mission over it. The booking rule covers only one live assignment against another; this covers the rest of the proposal check.
- **`bin/mctl` runs the CLI's TypeScript source directly** (design section 9, "a wrapper that runs the built CLI"). Node strips the types itself from 22.18 on, so there is nothing to build and `bin/mctl` is one `node` command. The Node requirement rises from 22 to 22.18 for it.
- **A login with no profile name is kept as `default`** (design section 8 leaves it open). `--profile`, then `MCTL_PROFILE`, names the profile a login is kept under, as they name the profile any other command acts as.
- **Logging out keeps the profile and forgets its token.** Its organisation, email and API address stay, so `mctl profile list` shows it as logged out and any command acting as it prints the exact command to log back in.
- **The acting-as line is printed by every command that acts as a profile,** login included, once it has logged in. `mctl status` and `mctl profile list` print it when a profile is in use; a command run with no profile has no line. The password prompt is written to the error stream too, so standard output stays clean.
- **`mctl status` exits 1 when the API cannot be reached, or answers but not as the contract says,** after reporting which, so a script can wait on it. With `--json` it prints its own report (`api`, `reachable`, `profile`, `expires_at`), as do `mctl profile list`, `profile use` and `logout`, which call no API. No command ever prints a token, except `mctl login --json`, which prints the API's login answer as it came.
- **A token the API no longer accepts** (its user removed, or the secret changed) exits 3 like an expired one, naming the profile and printing the command that logs it back in. An answer from the API that the CLI cannot read as the contract's exits 1, suggesting the two come from different versions.
- **The CLI's files** (design section 9): `commands/` holds one file per noun, where the login's commands (`login`, `whoami`, `logout`) share `commands/login.ts` and what the other commands share is in `commands/shared.ts`; `output/` holds the styling and printing, with the match run, the mission and the putting of reasons into words each in a file of its own; the password and confirmation prompts, which read input, are `prompt.ts`; choosing and checking the profile a command acts as is `session.ts`.
- **A next command is printed where one naturally follows**: after logging in, switching profile and logging out, and after every change a command makes. `whoami`, `status`, `profile list`, the other lists, `mission history`, `crew show`, `org show` and `availability remove` are checks or ends with no natural next step, so they print none. `mission show` prints the one the mission's state calls for. A next step that is another person's names them before the command, which stays pasteable: `Next (a director): mctl mission approve MSN-8`. These hints read the mission's state as the API reported it (an open slot, a problem, every slot accepted); they suggest, and the API still decides. `logout` asks no confirmation: nothing it forgets is lost that logging in again cannot restore.
- **An expired login is caught before the API is asked,** from the expiry the login answer gave, so the refusal can name the profile and print the exact command to log back in, `--api` included when the address is not the default. The API remains the authority: a token it refuses is reported the same way.
- **The password is read safely.** `--password-stdin` is refused on a terminal, which would echo the password; Ctrl-C or Ctrl-D at the hidden prompt cancels the login with exit code 130, as shells report an interruption. The config file is written whole to a new 0600 file and renamed into place, so a token is never in a file others can read and a crash leaves the old logins intact.
- **`pnpm demo:login` is a TypeScript script** that takes the demo password and the users' emails from the seed data, logs in each profile, and ends with `mctl profile use lead`, so `lead` is current even over an existing config file.
- **The CLI's integration tests run the API as a separate process** on the test database, seeded first, and drive `mctl` in-process against it, so the CLI is tested only through HTTP, as it runs. Two tests run `bin/mctl` and `pnpm demo:login` as real processes.
- **A match run says what each score component was worked out from** (design section 6.6 asks for the score's breakdown by component). Each component carries its basis: the level held, the days assigned out of the 180 around the start, or the days rested, null for one who has never flown; a nearest miss carries the level they hold the skill at. The design's output prints these ("level 5 (36 of 45) · 20 of 180 days assigned"), and the CLI holds no business logic (D13), so it reads them rather than working them back out of the formulas. A run saved before this change no longer reads; `pnpm demo:reset` clears them.
- **Periods are printed with both ends as stored** ("1–20 Mar 2027" for `[2027-03-01, 2027-03-20)`), as the design writes them and as `--from` and `--to` take them. A date beside a mission leaves out the year when it is the mission's year ("availability block AVL-3, 5–12 Mar").
- **What the match run output says where the design is silent.** Losses are counted in the matcher's order, with "do not have the skill" last, as the design's example has it. "Lower the level" is offered only to the level of a nearest miss who lacks nothing else, so that the command would fill the slot; "or the headcount" lowers it to the slots filled, and when none were, the requirement can be dropped instead (`mctl mission unrequire`). The commands follow a requirement's last unfilled slot, once, and only on a draft, since only a draft's requirements change. An unfilled slot lists no alternates: every one fills another slot, which the losses already count. A clash warning names the crew member rather than using a pronoun. "Pick another" names an alternate who is neither chosen elsewhere nor in a clash. An applied run's footer says when it was applied; a run that fills nothing says there is nothing to apply.
- **The match run's header comes from a second call** for the mission's name and period, since a run names its mission only by reference. It shows the mission as it is now.
- **`mctl match apply` asks when the API refuses a clash**, which it checks against the data as it is when applying, rather than reading the run first. The question carries the API's naming of the clash; with no terminal the refusal stands (exit 6), with a hint to add `--yes`.
- **`--json` where there is not one answer.** `mctl match run --apply --json` prints both answers, as `{ "match_run": …, "mission": … }`. `mctl availability remove --json` prints `{ "removed": "AVL-3" }`, since the API answers with no body.
- **Which commands ask first**: `mission cancel`, `assignment remove`, `assignment clear` and `availability remove`, each of which ends or deletes a mission lead's or director's record. `mission reject` and `assignment decline` do not: each is a person's recorded decision on something put to them, given with its reason, and the walk-through runs `assignment decline` without `--yes`. Nor does `mission unrequire`, which `mission require` undoes. With no terminal to ask on and no `--yes`, they refuse with exit 2 and change nothing; an answer other than yes changes nothing and exits 1.
- **`mission reject` and `mission cancel` take `--note` as a required option**, so a missing reason is a usage error (exit 2) before anything is asked, rather than a refusal from the API after the confirmation. Levels and counts must be whole numbers, also exit 2.
- **What `mctl mission show` prints** (design section 8 gives its content, not its layout): the status, owner, submitter and approvals, then a heading per requirement and a line per slot, numbered "1 of 2", with the assignment's reference so it can be released. An open slot says so; a declined crew member is listed under the slots without a number, with their reason. A crew member sees only their own slot. `mission list` names each clash's crew member, other mission and its owner, and counts any other problems.
- **`mctl org show` prints the match weights as the organisation stored them** (`proficiency 0.45`), not as shares of their sum, which is the matcher's working.
- **The walk-through starts from `pnpm demo:reset` and `pnpm demo:login`** (design section 8 runs `pnpm demo:login` as act 1's first command). Its blocks hold only `mctl` commands and what they print, which `readme.int.test.ts` runs and compares; the six logins `pnpm demo:login` prints would bury the act's start.
- **Act 2 releases Ada with `mctl assignment remove ASG-10 --yes`** (design section 8 leaves out `--yes`). The test runs the README with no terminal, where the command refuses to go ahead unasked; at a terminal it asks first, and the comment says so.
- **The README's walk-through is a second end-to-end test.** Design section 10 asks for the walk-through as a scripted test; `walkthrough.int.test.ts` is that script, asserting outcomes through `--json`, and `readme.int.test.ts` runs the README's commands as written and compares what they print, twice, with `pnpm demo:reset` and `pnpm demo:login` before each pass. It stands in a fixed address (`http://localhost:3000`) for its own API's, and a placeholder for times, the only parts of the output that differ between runs.
- **A reseed ends every login** (design section 8, "`pnpm demo:reset` reseeds"). It rebuilds the users, and a token's user must still exist, so `pnpm demo:login` follows `pnpm demo:reset`; a command run before it prints the command to log back in.
- **Row-level security is forced, and the owner bypasses it by role attribute** (design section 5; the research note recommends not forcing it). The issue asks for policies enabled and forced. Forced, they bind a table's owner too, which would hide every organisation from the seed, the test fixtures and the login lookup, which runs with the owner's rights. So the owner role is created with `BYPASSRLS`, and the API role without it. Seeing across organisations then depends on one attribute a test checks, not on who owns a table.
- **The policies apply to every role, not only the API role** (design section 5, "one policy per table"). The API role's name comes from `DATABASE_URL`, so a migration cannot name it; and a policy for every role binds any role added later. The owner is exempt only through `BYPASSRLS`.

## More

- [`DESIGN.md`](DESIGN.md): the design this build follows, written before it.
- [`CONTEXT.md`](CONTEXT.md): the glossary, whose terms the code, the API and the CLI use.
- [`CODING_STANDARDS.md`](CODING_STANDARDS.md): how code is written here, each rule with its reason.
- [`CHANGELOG.md`](CHANGELOG.md): what each change added, changed and fixed.
- [`transcripts/`](transcripts/): the unedited AI transcripts of the design and the build.
