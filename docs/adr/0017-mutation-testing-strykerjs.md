<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0017: Mutation Testing with StrykerJS

## Status

Accepted

## Date

2026-03-19

## Context

papai had over 600 passing unit tests and line coverage above 80%, but line coverage alone is a weak quality signal: a test that calls a function without asserting its return value registers as covered while providing no regression protection. The project needed a metric that measures whether tests actually detect incorrect behaviour, not merely whether they execute code.

Mutation testing addresses this gap by systematically injecting small code changes (mutants) — such as flipping a comparison operator, negating a condition, or replacing a string literal — and verifying that at least one test fails for each. A mutant that no test kills is a "survived" mutant and identifies an untested logical branch or an assertion gap.

The initial full run (2026-03-21) confirmed the problem quantitatively: 757 passing tests killed only 729 of 2,786 testable mutants, a 26.2% mutation score. Every one of the 2,057 surviving mutants had NoCoverage = 0, meaning all were executed but none were caught by assertions. The dominant surviving mutation types were `StringLiteral`, `ObjectLiteral`, `ConditionalExpression`, `BlockStatement`, and `EqualityOperator` — all indicating tests that do not verify the shape or value of returned data.

The decision was to adopt mutation testing as a first-class quality gate: a local developer tool and a mandatory CI job with an incrementally enforced break threshold.

## Decision Drivers

- Tests must assert return-value shape and exact field values, not just that a function completes
- The toolchain must work with the existing `bun:test` runner without rewriting ~50 test files
- CI must enforce a minimum mutation score and block PRs that regress it
- Local re-runs must be fast; only changed files should be re-mutated by default
- The TypeScript compiler must pre-filter compile-error mutants to avoid false negatives
- No new mandatory developer tool installation; the runner must resolve through existing `devDependencies`

## Considered Options

### Option 1: Community Bun Runner Plugin (`stryker-mutator-bun-runner`)

- **Pros**: Native Bun test integration; `coverageAnalysis: "perTest"` possible, enabling fast per-mutant filtering
- **Cons**: Version 0.4.0, single maintainer, pre-1.0 stability; low adoption; risk of abandonment with no fallback

### Option 2: Vitest Adapter Layer

- **Pros**: StrykerJS has a first-class Vitest runner with full `coverageAnalysis` support; mature ecosystem
- **Cons**: Would require rewriting `bun:test` mock patterns (`mock.module`, `mock.restore`, `beforeEach` hooks) across approximately 50 test files; changes test semantics, not just runner wiring; significant migration cost with no functional benefit

### Option 3: Command Runner (chosen)

- **Pros**: Shells out to `bun test` as-is; zero changes to existing tests; works with any test runner; immediately compatible with the full test suite; TypeScript checker integration still available
- **Cons**: `coverageAnalysis` must be `"off"` (command runner cannot do `perTest` coverage); all tests run per mutant, which is slower for large mutation scopes; partially mitigated by incremental caching

## Decision

Adopt StrykerJS with the command runner (`@stryker-mutator/core` + `@stryker-mutator/typescript-checker`) as the mutation testing framework. The command runner delegates test execution to `bun test`. The TypeScript checker pre-filters mutants that would not compile, preventing false negatives caused by type errors rather than missing assertions. Incremental mode caches mutant results across runs, making local re-runs significantly faster.

Mutation scope is limited to business logic files: `src/providers/**/*.ts`, `src/tools/**/*.ts`, `src/errors.ts`, `src/config.ts`, `src/memory.ts`, and `src/users.ts`. Re-export barrel files (`index.ts`), static value files (`constants.ts`), and the provider type interface (`providers/types.ts`) are excluded as they contain no testable logic.

## Rationale

The command runner won because it required zero changes to the existing test suite. The `bun:test` mock infrastructure in papai relies on `mock.module()` hoisting patterns that are not compatible with Vitest without a full rewrite. The community Bun plugin was too immature for a production quality gate. The performance trade-off of running all tests per mutant is acceptable: the test suite completes in under two seconds, and the mutation scope is narrowed to exclude scaffolding files.

The TypeScript checker integration provides a meaningful benefit even with the command runner: mutants that produce compile errors are eliminated before any test execution, reducing total test invocations and preventing noise from type-invalid mutations being classified as survived.

Incremental mode addresses the performance concern for day-to-day use. The `reports/stryker-incremental.json` cache means that only mutants in files modified since the last run need to be re-tested. CI persists this file across runs via `actions/cache`, so each CI run builds on the previous baseline rather than starting from scratch.

## Consequences

### Positive

- Mutation score becomes the primary regression-detection metric, catching logic changes that line coverage misses
- All tests run per mutant with `bun test` as used in CI, ensuring mutation results are reproducible
- TypeScript checker eliminates compile-error mutants before test execution, reducing noise
- Incremental caching makes local re-runs fast; only changed-file mutants are re-tested
- Mutation scripts (`test:mutate`, `test:mutate:changed`, `test:mutate:file`) give developers clear options for different workflows
- HTML report (`reports/mutation.html`) uploaded as a CI artifact provides a browsable per-file and per-mutant breakdown
- `thresholds.break` provides a hard CI gate that blocks score regression

### Negative

- `coverageAnalysis: "off"` means all tests run for every mutant; full runs over the entire mutation scope are slow (minutes, not seconds)
- The command runner cannot attribute which specific test kills a given mutant, limiting debuggability
- Incremental cache correctness depends on Stryker correctly tracking file modification; stale caches require a `--force` run to clear
- `reports/` directory is gitignored; the incremental cache is managed through GitHub Actions cache rather than source control

## Implementation Status

**Status**: Implemented (with divergence)

Evidence:

- `stryker.config.json` — configuration file present at project root with command runner, TypeScript checker, full `mutate` glob list, incremental mode, and reporter configuration
- `package.json` — `test:mutate`, `test:mutate:changed`, and `test:mutate:file` scripts present; `@stryker-mutator/core@^9.6.0` and `@stryker-mutator/typescript-checker@^9.6.0` in `devDependencies`
- `.gitignore` lines 41–42 — `.stryker-tmp/` and `reports/` entries present
- `knip.jsonc` line 29 — `"ignoreDependencies": ["@stryker-mutator/typescript-checker"]` present, suppressing the false-positive unused-dependency warning for the runtime-loaded checker plugin
- `.github/workflows/ci.yml` lines 75–104 — `mutation-testing` job present with Bun 1.3.11, `actions/cache` for incremental file, `bun run test:mutate` step, and HTML artifact upload with 14-day retention

Divergences from the design plan:

| Aspect                  | Planned                                                                                    | Actual                                       | Notes                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `commandRunner.command` | `bun test tests/providers tests/tools tests/db tests/utils tests/commands tests/*.test.ts` | `bun test`                                   | `bunfig.toml` now handles exclusion and preload; no need for an explicit path list                                   |
| `thresholds.break`      | `null` (no enforcement initially)                                                          | `25`                                         | Set after Phase 1 established a 26.2% baseline; `break: 25` enforces a floor just below baseline as the initial gate |
| `reporters`             | `["clear-text", "html", "json"]`                                                           | `["clear-text", "progress", "html", "json"]` | `"progress"` reporter added for real-time feedback during long runs                                                  |
| `ignorePatterns`        | `["tests", "node_modules", ".stryker-tmp"]`                                                | `["node_modules", ".stryker-tmp"]`           | `"tests"` entry removed; unnecessary since the `mutate` globs already target only `src/`                             |

## Rollout

### Phase 1 — Baseline and initial enforcement (completed 2026-03-21)

Full run established a 26.2% baseline (729 killed / 2,786 testable). Six recurring-task tool files had 0% mutation score with 157 survived mutants total. Tests for `makeDeleteRecurringTaskTool`, `makeUpdateRecurringTaskTool`, `makeResumeRecurringTaskTool`, `makePauseRecurringTaskTool`, `makeSkipRecurringTaskTool`, and `makeListRecurringTasksTool` were added to `tests/tools/recurring-tools.test.ts`, targeting exact return-value shape assertions, boundary conditions (`confidence < 0.85` / `>= 0.85`), and block-statement coverage. Phase 1 alone was projected to add 157 killed mutants, raising the score to approximately 31.8%. `thresholds.break` was set to `25` as the first enforcement gate.

### Phase 2 — YouTrack operations buffer (completed 2026-03-21)

New test files created for YouTrack operation functions that had high survived-mutant counts:

- `tests/providers/youtrack/operations/tasks.test.ts` — create, get, update, delete, list, search operations with mock `youtrackFetch`
- `tests/providers/youtrack/operations/projects.test.ts` — list (archived filtering), get, create (shortName generation), update, delete
- `tests/providers/youtrack/operations/comments.test.ts` — add, list, update, delete comment operations
- `tests/providers/youtrack/labels.test.ts` — label CRUD, task label assignment/removal, color conditional

### Phase 3 — Ratchet (ongoing)

Periodically raise `thresholds.break` toward the `thresholds.high` value of 80 as the mutation score improves. Review HTML reports to prioritise high-value surviving mutants in `providers/kaneo/column-resource.ts` and `providers/kaneo/task-status.ts`. If `StringLiteral` or `ObjectLiteral` mutations from logger call arguments produce disproportionate noise, add `mutator.excludedMutations` selectively.

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-19-mutation-testing-design.md`
- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-19-mutation-testing-implementation.md`
- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-21-mutation-score-to-30pct.md`
