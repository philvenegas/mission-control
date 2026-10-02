---
name: mission-control-domain
description: Mission Control domain language and invariants — organisations (tenants), users and roles, crew, skills, missions, assignments, matching, approval. Use when writing or reviewing code, tests, seed data, CLI output or docs in this repo, when naming a domain concept, or when a change touches tenancy, the mission lifecycle, assignments or the matcher.
---

# Mission Control domain

Mission Control is a B2B platform where space organisations plan missions and staff them with crew. A mission lead defines what a mission needs, the matcher proposes a crew, a director approves, and crew respond.

Three files, one job each:

- [`CONTEXT.md`](../../../CONTEXT.md) — the **vocabulary**. Read it before naming anything. Use its terms exactly in code, tests, API fields, CLI text and docs; prose uses British spelling (`organisation`), identifiers shorten it to `org`.
- This skill — the **invariants**.
- [`DESIGN.md`](../../../DESIGN.md) — the mechanics: tables, transition guards, score formulas, endpoints, commands.

## Invariants

Each holds everywhere, and each has a test that fails when it is broken.

1. **Tenant from the token.** The organisation is read from the signed token and set on the request's database transaction; every query runs inside that transaction. Paths and bodies carry references only.
2. **Unseen is 404.** A record the caller may not see answers exactly as a missing one. A record they can see but may not act on answers 403.
3. **Approver is another person.** Whoever submitted a mission cannot approve or reject it, whatever their role.
4. **Edit in draft.** A mission's requirements, period and crew change only while it is `draft`; what is approved is what was submitted.
5. **One lifecycle table.** Every status change goes through the transition table and writes an event in the same transaction.
6. **One live assignment at a time.** A crew member's live assignments (held, offered, accepted) never overlap in period. A proposal on a draft is a plan, not a hold. The database constraint is the authority; application checks only improve the error message.
7. **The matcher suggests.** A match run changes nothing until a person applies it.
8. **The matcher is pure.** Input in, result out, same input same result. It knows nothing of HTTP or the database.
9. **The API decides.** The CLI sends requests and formats responses.
10. **Every exclusion has a reason.** A crew member left out of a slot, or a slot left unfilled, can always be explained to the mission lead.
11. **References only.** Requests and responses name records by reference, which resolves inside the caller's organisation. Internal ids stay inside the API.
12. **Errors are thrown.** A failed request leaves no writes: every error is a thrown domain error, and any throw or any response of 400 or above rolls the request's transaction back.
13. **Submitted means sound.** Submit succeeds only when every proposed assignment passes the proposal check: no clash, no failed hard constraint.
14. **No overrides.** Nobody assigns a crew member against a hard constraint; the blocking record is changed instead.

## Where the mechanics live

| Touching | Read `DESIGN.md` |
|---|---|
| Tables, columns, constraints | §3 |
| Transitions, guards, effects | §4 |
| Who may do what; authentication | §5 |
| Hard constraints, scoring, solving, match output | §6 |
| Endpoints, error shape | §7 |
| Commands, output, exit codes | §8 |
| Package boundaries | §9 |
| What to test and seed | §10 |

When a decision changes: a term moves in `CONTEXT.md`, a mechanic in `DESIGN.md`, an invariant here.

## Done

A change is done when every domain name it introduces is a term in `CONTEXT.md`, and every invariant it touches is exercised by a test in the same change.
