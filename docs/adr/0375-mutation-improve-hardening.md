<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0375: Mutation-Improve Hardening — Typed Error over Message Regex, NaN-Threshold Guard, and a Cross-Workspace Contract Guard

## Status

Accepted

## Date

2026-08-05

## Context

PR #222 landed the autonomous `mutation-improve` runner and deferred four non-blocking review items. One (`--reset-worktree` parsed but not consumed) was already resolved on a later branch; the remaining three became this hardening change, designed in `docs/superpowers/specs/2026-08-05-mutation-improve-hardening-design.md` and planned in `docs/superpowers/plans/2026-08-05-mutation-improve-hardening.md`:

1. **Parser coverage with a latent bug.** `parseCliArgs` (`mutation-improve/src/cli.ts`) had real uncovered branches, and one of them was a genuine bug: `--threshold=abc` passed through `Number(...)` as `NaN`, which then flowed into `config.threshold`, making every `>= threshold` comparison in the pipeline false — the gate would reject every iteration silently.
2. **Retry fragility.** `measureMutationScore` (`mutation-improve/src/score-reader.ts`) decided whether to re-run Stryker by regex-matching error-message *wording* (`/enoent|malformed|must contain a stryker/iu`) emitted by a foreign module (`scripts/mutation/json-readers.ts`). If that module's prose drifted, the retry would silently stop firing; a malformed-but-differently-worded error would propagate as a hard failure instead of triggering the documented single retry.
3. **Unguarded cross-workspace coupling.** `mutation-improve` imports a broad surface of `review-loop/src/*` by relative path. TypeScript catches removed or renamed symbols at compile time, but nothing pinned behavioral drift (a changed return shape with the same name), and `tests/mutation-improve/contracts.test.ts` previously guarded only the two Zod schemas.

## Decision Drivers

- **No runtime behavior change.** The retry's trigger set (report-missing `ENOENT`, wrong-shape report) must be preserved exactly — same inputs retry, same inputs propagate; only the detection mechanism may change.
- **Decouple by type, not by string.** A control decision must not depend on a sibling module's prose.
- **Proportionate hardening.** The cross-workspace guard stays a contract test in the consumer's own gate; no new shared `harness/` workspace and no facade module in `mutation-improve/src` — the composition root (`cli.ts`) keeps its direct imports, which is where concrete imports belong.
- **Reuse existing test files.** Parser cases extend `cli.test.ts`; the cross-workspace guard extends `contracts.test.ts`.
- **TDD ordering discipline.** When a test must reference a new symbol by identity (`toThrow(ReportReadError)`, `toBe(DEFAULT_CONFIG_PATH)`), the symbol's declaration lands first as inert plumbing so the red signal is a behavioral assertion failure, not a module-load error.

## Considered Options

### Option 1 — Typed `ReportReadError` + structured error-code check, NaN guard, two-tier contract guard (chosen)

Three bundled, independent edits: (a) export `DEFAULT_CONFIG_PATH`, add a `Number.isFinite` guard to the `--threshold=` branch, and cover the five uncovered parser branches; (b) add `export class ReportReadError extends Error` to `scripts/mutation/json-readers.ts` and have `readStrykerReport` throw it, then key the score-reader retry off `isRetryable(error)` — `error instanceof ReportReadError || error.code === 'ENOENT'` — replacing the message regex; (c) extend `contracts.test.ts` with a Tier-A behavioral block (`LiveRenderer.log` passthrough; `createShellExec` + `runBuildCheck` exit-code→passed round-trip via `sh -c true`/`false`) and a Tier-B inventory block asserting presence/callability of every consumed review-loop symbol.

- **Pros:** the retry can never silently stop firing because a message string changed; the NaN bug dies at the parser boundary where `--count` already validates; contract drift fails loudly in mutation-improve's own test gate without touching review-loop; the retry trigger set is provably unchanged (the plain-Error no-retry test passes under both old and new implementations).
- **Cons:** `ReportReadError` lives in `scripts/mutation/`, one directory away from its consumer, so the coupling crosses workspace boundaries by design; the Tier-A `sh -c` round-trip relies on a POSIX shell being present (consistent with the existing `cli.test.ts` exception).

### Option 2 — Keep the message regex, just expand it (rejected)

Add the new message variants to the existing regex.

- **Pros:** smallest diff.
- **Cons:** doubles down on the fragile mechanism — every future wording change in a foreign module is a silent retry regression; rejected in favor of type/code-based detection.

### Option 3 — Shared `harness/` workspace or facade module for the review-loop surface (rejected)

Extract the consumed review-loop functions into a shared package or wrap them behind a facade in `mutation-improve/src`.

- **Pros:** a single import boundary to version.
- **Cons:** heavy refactor of review-loop for a non-blocking follow-up; the plan's design note is explicit that TypeScript already catches symbol removal/rename, so the incremental value of a facade over a contract test is small relative to the churn.

## Decision

Adopt Option 1, implemented test-first in four tasks: parser hardening (`DEFAULT_CONFIG_PATH` export + `Number.isFinite` guard + coverage), typed `ReportReadError` in `json-readers.ts`, `isRetryable`-keyed retry in `score-reader.ts`, and the two-tier review-loop surface contract in `contracts.test.ts`. The error message string inside `readStrykerReport` is kept byte-identical for log-grepping humans; only the thrown type changes.

## Consequences

### Positive

- `--threshold=abc` now throws at parse time instead of silently poisoning `config.threshold` with `NaN` and rejecting every pipeline iteration.
- The score-reader retry is keyed on a typed error class and the structured `ENOENT` code; foreign-module wording can drift freely without changing control flow.
- The consumed review-loop surface (`runAgent`, `createShellExec`, `runBuildCheck`, `LiveRenderer`, `realSpawn`, six worktree helpers) is inventoried and behaviorally pinned in mutation-improve's own gate; removal, export-shape drift, or a broken exit-code mapping fails there, not at runtime.
- `parseCliArgs` is fully covered on its throwing branches: unknown argument, missing flag value, fractional/non-numeric `--count`, non-numeric `--threshold=`, and the default config path.

### Negative

- `scripts/mutation/json-readers.ts` now exports a class consumed across a workspace boundary; renaming or moving it requires updating both workspaces (mitigated: the contract tests and TypeScript catch it immediately).
- Tier-A's `sh -c true`/`false` round-trip assumes a POSIX shell on the test host — accepted as consistent with the existing test-isolation exception documented in the plan.
- The inventory tier (Tier B) asserts presence and callability only; behavioral authority for the git-/opencode-requiring symbols remains in `tests/review-loop/**`, so some drift classes still escape this guard by design.

### Risks

- A future error type that *should* retry but is neither `ReportReadError` nor `ENOENT`-coded will propagate. Mitigation: the behavioral contract is enumerated in the plan and pinned by five retry tests; adding a new trigger requires a deliberate, reviewed change to `isRetryable`.

## Implementation Notes

- TDD ordering: `DEFAULT_CONFIG_PATH` (cli.ts:38) and `ReportReadError` (json-readers.ts:21) were declared as inert plumbing before the tests that reference them by identity, so red signals were behavioral assertion failures.
- The ENOENT-code test (`Object.assign(new Error('not found'), { code: 'ENOENT' })`) is the crux case: under the old regex the message `'not found'` did not match, proving the old implementation keyed on text while the new one keys on `.code`.
- Verified: all 29 tests across `tests/mutation-improve/{cli,score-reader,contracts}.test.ts` pass; `tests/scripts/mutation/paired-run.test.ts` (the other `readStrykerReport` consumer) unaffected — it lets the error propagate.

## Implementation Status

Implemented. `mutation-improve/src/cli.ts:38` exports `DEFAULT_CONFIG_PATH` and cli.ts:71 carries the `Number.isFinite` guard; `scripts/mutation/json-readers.ts:21` defines `ReportReadError` and `readStrykerReport` throws it (line 31); `mutation-improve/src/score-reader.ts:19-24` implements `isRetryable` with the retry `catch` keyed on it; `tests/mutation-improve/contracts.test.ts:70` contains the `review-loop surface contract` block with both tiers. All 29 tests pass (`bun test tests/mutation-improve/...`). The plan's 26 checkboxes were left unticked, but every task's code and tests are present and green.

## Related Decisions

- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — the mutation-gate mechanics the mutation-improve runner operates under.
- ADR-0303: Review-Loop Parallel Fixes Inspector — the sibling workspace whose surface this contract guard consumes.
- ADR-0334: Plugin Test Quality — Behavior-Only Mutation Survivors — same behavioral-pinning test philosophy applied elsewhere.

## References

- Spec: `docs/superpowers/specs/2026-08-05-mutation-improve-hardening-design.md`
- Plan: `docs/superpowers/plans/2026-08-05-mutation-improve-hardening.md`
- Source: `mutation-improve/src/cli.ts`, `mutation-improve/src/score-reader.ts`, `scripts/mutation/json-readers.ts`
- Tests: `tests/mutation-improve/cli.test.ts`, `tests/mutation-improve/score-reader.test.ts`, `tests/mutation-improve/contracts.test.ts`
