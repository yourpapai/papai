# Design: fix-oxlint-180-findings

## Context

oxlint 1.80 (arriving via PR #398) reports three diagnostics over code that compiles and
passed 1.78. Verified by probe and full lint run (see proposal.md — What Changes):

- `sdd-runner/src/event-schemas.ts:90` `no-redeclare` on `DoneEvent` — a `const DoneEvent = z.object(...)`
  coexisting with `export type DoneEvent` (line 294). Legal TypeScript (declaration spaces
  differ); `tsc --noEmit` passes. oxlint 1.80 stopped exempting the pairing.
- `sdd-runner/src/orchestrator.ts:59` + `:67` — two byte-identical `RunResumeResult` interface
  declarations, silently merged by TS structural merging until now.
- `tests/review-loop/test-helpers.ts:177` — `append(_: TraceEvent)`; oxlint 1.79's
  `no-unused-vars` now reports bare `_` parameters. This is the repo's only bare-`_` param.

Constraints: repo policy forbids lint-disable/type-ignore comments (write-policy hook blocks
them), and `.oxlintrc.json` edits are gated. All three files exist already — no new files, so
the Write/Edit TDD hook pipeline adds no new gated files; the existing hook checks apply to the
three edits as usual.

## Goals / Non-Goals

**Goals:**

- `bun run lint` exits 0 with oxlint 1.80 while keeping 1.78 semantics intact (fixes are
  no-ops for the old linter), so PR #398 can merge green.
- Fix root causes in code; keep upstream rule defaults strict.

**Non-Goals:**

- No oxlint config changes (no `argsIgnorePattern`, no rule demotions) — see D1.
- No new tests; the lint gate itself is the check (see D4).
- Broader PR #398 opportunities (rrule strict mode, Bot API 10.3, strybk regen) — declined in
  proposal.md Non-goals.

## Decisions

**D1 — Rename `DoneEvent` const to `DoneEventSchema`; do not re-lax `no-redeclare`.**
Rationale: matches the repo's `XSchema` convention (`ChildDoneEvent` next door deviates too but
is unflagged because no type shares its name); keeps the stricter upstream default so future
pairings get caught. Alternative considered: `oxlint` config override exempting type-space
redeclarations — rejected: config edits are hook-gated, and re-laxing a fresh upstream
tightening forfeits its value. The exported `type DoneEvent` name is unchanged, so importers of
the type are unaffected; only in-file refs (line 244 union member, line 274 `.extend`) move.

**D2 — Delete the second `RunResumeResult` interface (lines 67–73); keep the first.**
The declarations are byte-identical (verified by diff), so deletion changes the merged type
not at all. Alternative considered: keep one and add a comment about intent — rejected:
redundant.

**D3 — Rename the bare `_` parameter to `_event`; no config escape hatch.**
Underscore-prefixed non-bare parameters remain exempt under the 1.79 default, and `_event`
documents what is discarded. Only one site exists repo-wide (checked `_\\(` patterns), so no
sweeping convention change is implied.

**D4 — Sequencing and verification model: master-first, lint as the gate.**
Land on master before PR #398 merges: all three edits are behavior-neutral under oxlint 1.78
(green on master today), then `@dependabot rebase` picks them up and the PR's lint leg clears.
Dependabot branches reject pushed commits, so fixing on the PR branch is not an option.
Test-first does not apply — there is no runtime behavior to assert; the red/green cycle is
`bun run lint` itself (currently 3 failures → 0 after the edits). The mutation gate is
unaffected: `sdd-runner/` and `tests/` select zero mutation targets by design.

## Risks / Trade-offs

- [Renaming `DoneEvent` const misses a reference] → Only three in-file refs exist (90, 244,
  274); `bun run typecheck` + `bun run lint` after the edit catch any straggler.
- [Future bare-`_` params land and re-break lint] → Accepted; the new default is the point of
  the upstream change, and CI fails loudly with a one-line fix.
- [PR #398 merges before these fixes land] → `bun run lint` fails on master until the fixups
  arrive; the fixes remain valid and mergeable regardless of order.

## Migration Plan

Not applicable — no data, API, or deploy surface changes. Rollback is `git revert` of three
mechanical edits.
