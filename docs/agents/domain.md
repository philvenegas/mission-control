# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary. One context covers the whole repo, including every package under `packages/`.
- **`DESIGN.md`** at the repo root: the decisions. Section 2 lists each decision with its reason and the alternative rejected; sections 3 to 10 hold the mechanics. It plays the part ADRs play elsewhere.
- **`.claude/skills/mission-control-domain/SKILL.md`**: the invariants, each of which has a test.
- **`docs/adr/`**: decisions made after the design was finalised, if any. If the directory does not exist, proceed silently.

## File structure

Single-context repo:

```
/
├── CONTEXT.md        the vocabulary
├── DESIGN.md         the decisions and mechanics (final; not edited during the build)
├── README.md         setup, and where the build diverged from the design
├── docs/adr/         later decisions, created lazily
└── packages/         contract, matcher, api, cli
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag conflicts with the design

`DESIGN.md` is final. If your output contradicts a decision in it or an ADR, surface it explicitly rather than silently overriding, and record the divergence with its reason in the README section "Where the build diverged from the design":

> _Contradicts D12 (double booking is prevented by a database exclusion constraint) — but worth reopening because…_
