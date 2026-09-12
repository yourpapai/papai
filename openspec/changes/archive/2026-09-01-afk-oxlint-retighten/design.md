<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See proposal.md — Why. The C7 re-tighten closed the afk-scoped `max-lines` pair, `max-classes-per-file`, and `no-unsafe-type-assertion` (except one file), leaving exactly two oxlint relaxations, both re-timed to U9. A probe measurement (oxlint 1.78.0, both overrides deleted from a config placed **at the repo root** — a config outside the repo breaks tsgolint's tsconfig resolution and floods unrelated files with bogus errors) surfaces exactly 19 diagnostics:

- `afk-runner/src/kernel/machine.ts:135-136` — 2 × `no-unsafe-type-assertion` on `setup({ types: { context: {} as KernelContext, events: {} as KernelEvent } })`.
- `tests/afk-runner/` — 17 × `no-unsafe-assignment`/`no-unsafe-member-access`, all from `JSON.parse` results bound to typed locals or annotated variables, in `cli-stop.test.ts` (113-114), `memo-parity.test.ts` (110), `memo-failed.test.ts` (85-87, 111-112), `run-final.test.ts` (17), `drive/memo.test.ts` (23, 61, 69, 79), `drive/resume-escalation.test.ts` (102-104), `work/veto-revision.test.ts` (61).

No new modules, dependencies, DB migrations, tool surfaces, or persisted state; no scope-model impact.

## Goals / Non-Goals

Goals: zero afk-scoped rule exceptions in `.oxlintrc.json`; lint green at repo defaults; zero change to runtime behavior, static types as consumed downstream, and test assertions.

Non-goals (design-level): reformatting `.oxlintrc.json` beyond deleting the two blocks; touching the jscpd oracle ignores; "improving" the tests beyond the minimal parse-site conversion.

## Decisions

### D1 — "Initial state" means the pre-afk rule surface, not byte-identical bytes

Delete the two afk-scoped `overrides` blocks and nothing else. The pre-afk file differs from today's also by the `import/extensions` array layout — pure oxfmt drift across versions; today's formatting is what `bun run format:check` accepts, so restoring the old layout could fight the formatter for zero rule change. The `tests/**/*.ts` override predates afk-runner and stays.

### D2 — machine.ts: annotation-driven inference on `setup`, not witnesses

xstate 5.25.0's `setup` signature (`node_modules/xstate/dist/declarations/src/setup.d.ts:110-113`) accepts `TContext`/`TEvent` as explicit generic arguments, and every field of `SetupTypes` (`types.d.ts:467-476`) is optional. **Landed form (apply-phase correction):** explicit type arguments turned out to suppress inference for the trailing registry parameters — partial explicit type args take their defaults, so `setup<KernelContext, KernelEvent>({…})` left `TGuards`/`TActions` at `{}` and every `createStateConfig` registry-string reference in the kernel tests stopped resolving (tsc-visible). The assertion-free spelling that preserves full argument inference is **annotated guard parameters**: `setup({ guards: { allStagesDone: ({ context }: { context: KernelContext }) => …, isStage: ({ event }: { event: KernelEvent }, params: { stage: string }) => …, … } })` — `TContext`/`TEvent` infer from the annotations, `TGuards` infers from the `params` annotation, and the un-annotated `assign` actions keep their contextual typing once the variables are fixed. Three annotations total, zero runtime code, registry typing identical (typecheck + 46 kernel/parity tests green). Alternatives rejected:

- Ambient `declare` witnesses — the documented dead end: ambient values are runtime `ReferenceError`s under Bun's eager module evaluation (recorded in `openspec/changes/afk-runner/design.md`).
- Explicit generic arguments on `setup` — breaks trailing registry inference (see above).
- `{} as unknown as KernelContext` — the second hop is still a narrowing assertion from `unknown`; the rule fires there too (and if it didn't, it would be by accident of the rule's implementation, not by intent).
- A helper module wrapping the assertion elsewhere — moves the problem, adds a module for two lines; minimality rejects.

Verification is behavioral, not just visual: the fold-parity harness (26 fixtures + live lane) and the kernel suites exercise the machine end-to-end; `bun run typecheck` proves the registry typing survived. If explicit generics surface new inference errors inside guard/action bodies, the fixes are types-only and stay in place.

### D3 — Test parse sites: existing exported schemas, per established repo pattern

The repo's established spellings (visible throughout `tests/sdd-runner/`, e.g. `orchestrator.test.ts:1687`, `veto-updater.test.ts:128`) are `Schema.parse(JSON.parse(...))`. The needed schemas already exist as exports:

- `PersistedRunStateSchema` (`afk-runner/src/run-state.ts:24`) — every `state.json` read (`cli-stop`, `memo-failed`, `run-final`'s `memoOf`, `drive/memo`, `resume-escalation`). This is the same schema the runner itself round-trips on read (`run-state.ts:172`), so every memo the runner writes parses by construction — strictness cannot reject a produced memo.
- `ResolverOutputSchema` (exported by the afk-runner `work/review-loop.js` copy; already imported by `work/veto-updater.ts:17`) — the veto sidecar in `work/veto-revision.test.ts:61`.
- `memo-parity.test.ts:110` — the local `PersistedMemo` interface is structurally the memo projection; parsing via `PersistedRunStateSchema` yields a type that satisfies the parity call (the schema carries the C5 D7 optional fields). If a field-level mismatch appears, keep the parity semantics and adapt the local interface to the schema-inferred type — never the reverse (the schema is the contract the runner writes).

For partial-field assertions, full-schema parse is preferred over local sub-schemas — same validation the runtime performs, one import, no new test-local schema surface to drift.

### D4 — Order of work, hooks, and the red signal

The Write/Edit TDD hooks gate `afk-runner/src/**`; test files are not gated. The natural test-first ordering falls out of the lint gate itself:

1. Delete the two override blocks → `bun run lint` red with exactly the 19 diagnostics (the probe's expected failure list is the spec of done).
2. Re-spell `machine.ts` (D2) → its 2 diagnostics green; `bun run typecheck` + `bun test tests/afk-runner/kernel tests/afk-runner/memo-parity.test.ts` prove typing/behavior parity (these pre-existing suites are the red/green cover for the gated src edit).
3. Convert the 7 test files (D3) → remaining 17 green; `bun test tests/afk-runner` proves assertion semantics unchanged.

### D5 — Docs close the window early

`docs/architecture/afk-runner.md` §"Prototype relaxation window (C1–C7) — closed" is updated: the `machine.ts` documented exception and the tests-side `no-unsafe-*` re-timing move from "re-timed to U9" to closed by this change; the U9 re-tighten surface shrinks to the jscpd oracle ignores alone. No other architecture page mentions these overrides.

## Risks / Trade-offs

- [oxlint/tsgolint version drift changes the diagnostic set between now and apply] → re-run the probe measurement as apply task 0 (config at repo root, overrides filtered); the task list says exactly which 19 are expected and anything extra gets triaged before fixing, not blindly suppressed.
- [Explicit generics change type inference somewhere downstream of `kernelSetup` (e.g. `createStateConfig` in tests)] → typecheck is the gate; any fallout is types-only and fixed in place; the parity corpus is the behavioral backstop.
- [A `state.json` fixture in the corpus predates a schema field and fails strict parse] → the schema's D7 projections are deliberately optional for exactly this reason (`run-state.ts:39`); if an unforeseen gap appears, the fixture is historical data and the assertion intent moves to schema-typed field reads, never to re-enabling an override.
- [Mutation gate re-measures `machine.ts` (typing-only diff)] → mutation scores are test-kill-based; a types-only change does not alter mutant survival, but the apply phase checks `test:mutate:changed` output rather than assuming.

## Migration Plan

Single PR, no rollout: config deletion + 8 file edits + doc update. Rollback is reverting the commit — the overrides are the only thing keeping the weaker surface, and no runtime artifact depends on any of this.

## Open Questions

None.
