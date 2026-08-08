<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0354: History Mutation Coverage — Glob-Negation Sandbox Fix, Log-Contract Tests via Cache-Busted Module Reloads, Baseline Ratchet to 1.0

## Status

Accepted

## Date

2026-08-02

## Context

`src/history.ts` had a ratcheted mutation floor of 0.21 in `scripts/mutation/baseline.json` — the lowest tier of enforced quality — while a probe measured 86 mutants: 59 killed, 21 survived (role-guard conditionals, arithmetic, and 18 log StringLiteral/ObjectLiteral mutants), 6 no-coverage (the entire `clearHistory` body). Two structural problems blocked raising the floor.

First, every top-level `src/*` paired mutation run errored before producing a score: commit `ae61aa748` added `.opencode` to Stryker `ignorePatterns`, so the sandbox copy lacked `.opencode/plugins/tdd-enforcement.ts`, which `tests/opencode-tdd-enforcement.test.ts` imports. The "same-package" expansion for root `src/*.ts` is all of `tests/*.test.ts`, so the dry run failed with `Cannot find module` for every top-level file — the ignore had targeted `.opencode/node_modules` (61M of junk) but also excluded `.opencode/plugins` (20K of required code).

Second, the surviving log-metadata mutants live behind `const log = logger.child({ scope: 'history' })`, bound at module evaluation. A static `import` in a test file captures the real logger before any `mock.module()` registered in the test body takes effect, so the log contracts were conventionally untestable without refactoring production code.

The design spec (`docs/superpowers/specs/2026-08-02-history-mutation-coverage-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-02-history-mutation-coverage.md`) define the fix; this ADR records the decisions.

## Decision Drivers

- **Fix the sandbox, not the test suite.** The `.opencode` exclusion broke measurement for every top-level `src/*` file; the correct fix is at the tooling layer (what the sandbox copies), not by rewriting or relocating the affected test.
- **Assert behavior through log contracts, not by changing production code.** The survived mutants were almost all observability metadata. `src/history.ts` itself stays unmodified — the work is test-side plus tooling config.
- **Reuse the proven repo pattern.** `tests/startup-helpers.test.ts` already solved module-eval-time logger binding with `mock.module()` + a cache-busting dynamic import (`?t=${crypto.randomUUID()}`); new tests follow it exactly rather than inventing a second mechanism.
- **Verify before ratcheting.** The baseline only moves after a probe run confirms 0 surviving + 0 no-coverage mutants, and the official paired runner (`bun test:mutate:file`) re-measures through the fixed config — the ratchet is monotonic and evidence-backed.
- **Never weaken mutation hygiene to pass.** Equivalent mutants would be reported, not suppressed with Stryker-ignore comments (hook policy blocks them anyway); none were expected or found.

## Considered Options

### Option 1 — Globby negations + contract tests via cache-busted imports (chosen)

Three independent changes: (1) replace the blanket `.opencode` ignore with `".opencode", "!.opencode/plugins", "!.opencode/plugins/**"` in `stryker.config.json` so globby copies the 20K plugins directory while still excluding `node_modules`; (2) add two role-guard tests to the existing `tests/history-edit.test.ts` (killing the `msg.role !== 'user'` → `false` ConditionalExpression mutants at L64/L106); (3) create `tests/history.test.ts` covering `clearHistory` and the structured-log contracts, registering `mock.module('../src/logger.js', ...)` inside each test body and force-reloading `src/history.ts` with a cache-busting query string so the module-level `logger.child()` binds the tracked mock. Then probe (86/86), official paired run, and ratchet `baseline.json` via the repo's own `mergeReports`/`loadBaseline`/`writeBaseline` functions.

- **Pros:** sandbox fix unblocks every top-level `src/*` paired run (`errored=1` → `errored=0`), not just history; production code untouched; test pattern mirrors an existing, proven suite; cache-busted reload re-evaluates only `src/history.ts` while `cache.js`/drizzle stay shared singletons, so DB-backed assertions still hit the same in-memory store; baseline raised to the measured 1.0, closing the file's mutation debt.
- **Cons:** the cache-busting dynamic import is subtle — a future contributor copying the file without the comment trail could statically import and silently bind the real logger; per-test `mock.module` registration adds a small runtime cost; the microtask-flush assertion in the `clearHistory` test couples to `syncHistoryToDb`'s `queueMicrotask` scheduling.

### Option 2 — Refactor `src/history.ts` for injectable logging (rejected)

Change the module to accept a logger (factory or DI parameter) so tests can pass a mock statically.

- **Pros:** tests become straightforward static imports; no cache-busting trickery.
- **Cons:** modifies production code purely to satisfy tests — the exact churn the plan rules out; changes the module's call signature for every consumer; solves one file's problem while the module-eval-binding pattern recurs elsewhere and is already handled by the cache-bust convention.

### Option 3 — Exclude `.opencode/node_modules` specifically instead of negations (rejected)

Replace `".opencode"` with `".opencode/node_modules"` in `ignorePatterns`.

- **Pros:** simpler pattern; no negation semantics to reason about.
- **Cons:** copies all other future `.opencode` content into every sandbox by default, re-opening the junk-copy problem the ignore targeted; the negation form expresses the intent precisely ("exclude `.opencode` except `plugins`") and was validated end-to-end by the probe dry run.

## Decision

Adopt Option 1. Ship the glob-negation sandbox fix, the two role-guard tests in `tests/history-edit.test.ts`, and the new `tests/history.test.ts` log-contract/clearHistory suite using the cache-busted module-reload pattern; register the pairing in `scripts/mutation/overrides.json`; verify 86/86 mutants killed in a probe; then re-measure through the official paired runner and ratchet `scripts/mutation/baseline.json` for `src/history.ts` to the measured score.

## Consequences

### Positive

- Every top-level `src/*` paired mutation run now passes its dry run — the `.opencode` sandbox regression is gone, unblocking re-measurement of other low floors (`src/config.ts`, `src/recurring.ts`, `src/memory.ts`, …) noted as follow-up in the spec.
- `src/history.ts` baseline ratcheted from 0.21 to 1.0; the PR gate now blocks any regression in role-guards, `removedCount` arithmetic, `clearHistory`, and all structured-log metadata for this file.
- The log contracts are executable documentation: metadata shape (`{ userId, messageCount }`, `{ contextId, messageId, removedCount }`, child scope `{ scope: 'history' }`) is pinned by tests.
- `overrides.json` now maps `src/history.ts` to both test files, so the coverage-derived test selection measures the real killing power.

### Negative

- `tests/history.test.ts` depends on Bun-specific `mock.module` + cache-bust semantics; it is not portable to another runner without rework.
- The pattern couples tests to module-eval timing; a refactor of `src/history.ts`'s imports could change what stays a shared singleton and invalidate assumptions.
- `.stryker-tmp/` probe configs are throwaway artifacts — the verification path is documented in the plan but not preserved as a runnable script.

### Risks

- A future edit to `.opencode/plugins` that adds large files would silently grow every Stryker sandbox. Mitigation: the negation is narrowly scoped to `plugins/**` only; new subtrees remain excluded by default.
- If `syncHistoryToDb` changes its scheduling (e.g. off `queueMicrotask`), the `clearHistory` test's single `await Promise.resolve()` flush breaks. Mitigation: the plan documents the coupling at the test site.

## Implementation Notes

- `stryker.config.json` ignorePatterns: `["node_modules", ".stryker-tmp", "reports", ".agents", ".codex", ".opencode", "!.opencode/plugins", "!.opencode/plugins/**", ".worktrees"]`.
- Test helper `loadHistoryModule(tracked)` registers the mock then imports `` `../src/history.js?t=${crypto.randomUUID()}` ``; each test builds a fresh `createTrackedLoggerMock()` so calls never leak between tests.
- The ratchet script reuses `mergeReports` / `loadBaseline` / `writeBaseline` so the score formula and sorted-JSON format match CI automation exactly; it throws if the measured score does not improve on the recorded baseline.
- Verified: probe at 100.00 (86/86), official paired run `errored=0`, root test batch + lint + typecheck clean; `baseline.json` entry `"src/history.ts": 1`.

## Related Decisions

- ADR-0328: Stryker Drop TypeScript Checker / TS7 Unblock — earlier mutation-tooling trade-off on the same stack.
- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — defines the baseline mechanics (`seedMerge`, monotonic floor) this change ratchets under.
- ADR-0334: Plugin Test Quality — Behavior-Only Mutation Survivors — same test-side mutant-killing philosophy applied to plugins.

## References

- Spec: `docs/superpowers/specs/2026-08-02-history-mutation-coverage-design.md`
- Plan: `docs/superpowers/plans/2026-08-02-history-mutation-coverage.md`
- Pattern source: `tests/startup-helpers.test.ts`; logger mock: `tests/utils/logger-mock.ts`
