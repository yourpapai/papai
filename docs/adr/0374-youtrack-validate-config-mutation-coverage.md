<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0374: YouTrack Validate-Config Mutation Coverage — Seven-Case Companion File Mirroring the Kaneo Twin, Zero Survivors

## Status

Accepted

## Date

2026-08-04

## Context

`plugins/task-provider-youtrack/validate-config.ts` had a paired mutation score of 0 (0 killed / 0 survived / 32 no-coverage of 32 mutants). The module is a 24-line pure function, `validateConfig(config: Record<string, string>)`, that validates the YouTrack plugin's `baseUrl`: required (trimmed, non-empty), parseable as a URL, and restricted to `http:`/`https:`. None of this behavior had any test.

The production code is correct; the deficit is missing tests. The design spec (`docs/superpowers/specs/2026-08-04-youtrack-validate-config-mutation-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-04-youtrack-validate-config-mutation.md`) define the fix; this ADR records the decisions.

## Decision Drivers

- **Test-only change.** `plugins/task-provider-youtrack/validate-config.ts` and every other source file stay unmodified — no refactoring-for-testability.
- **Own the conventional companion path.** The paired mutation runner's test-resolver auto-discovers the mirror path `tests/plugins/task-provider-youtrack/validate-config.test.ts`; no `scripts/mutation/overrides.json` edit is needed.
- **Mirror the proven kaneo twin.** `tests/plugins/task-provider-kaneo/validate-config.test.ts` (baseline 0.969) provides the describe name, case ordering, and assertion shape; the YouTrack copy adds one case the twin lacks.
- **Kill the twin's surviving mutant.** The kaneo twin leaves the `.trim()`-removal `MethodExpression` mutant alive; a whitespace-only `'   '` input kills it in the YouTrack file (without `.trim()`, length is 3, falls through to `new URL('   ')` → throws → wrong reason).
- **Characterization tests that pass immediately.** The code is correct, so the tests are green on first run; the quality gate is the paired mutation score (≥ 0.94), not test redness.
- **Full-object deep-equality assertions.** `toEqual` on the complete result object kills every `ObjectLiteral`, `BooleanLiteral`, and `StringLiteral` return mutant outright.
- **Baseline ratchets via CI, not by hand.** `scripts/mutation/baseline.json` is not edited; the master `mutation-baseline` job's `seedMerge` raises the floor post-merge (per-key max). The PR gate is regression-only.

## Considered Options

### Option 1 — Companion test file mirroring the kaneo twin plus the whitespace case (chosen)

Create `tests/plugins/task-provider-youtrack/validate-config.test.ts` with a single `validateConfig` describe block holding seven cases: valid https, valid http localhost, missing key, empty string, whitespace-only, malformed URL, non-http protocol. No fetch mocks, no DI, no store.

- **Pros:** production code untouched; conventional mirror path satisfies the paired runner with zero config; the twin's case set is already empirically proven at 0.969, and the added whitespace case is pre-analyzed to kill the one mutant the twin leaves alive; http-localhost case kills the `'http:'` StringLiteral and `!==`→`===` flip that an https-only case cannot distinguish; missing-key case kills the OptionalChaining and `??`-fallback mutants.
- **Cons:** characterization tests lock current behavior rather than specifying intended behavior; copying the twin duplicates a suite across files (accepted — mirror-path convention requires per-source files).

### Option 2 — Fold cases into an existing YouTrack plugin suite (rejected)

Extend an existing `tests/plugins/task-provider-youtrack/*` file with the validation cases instead of creating the companion file.

- **Pros:** no new file.
- **Cons:** violates the mirror-path convention the paired runner and TDD hook rely on; would require an `overrides.json` entry; mixes unrelated suites.

### Option 3 — Shared parametrized helper with the kaneo twin (rejected)

Extract a shared test factory both plugin companion files consume.

- **Pros:** removes case duplication.
- **Cons:** introduces a cross-plugin test dependency for two 24-line modules; breaks the self-contained companion-file convention; the whitespace delta means the suites are already divergent.

## Decision

Adopt Option 1. Ship `tests/plugins/task-provider-youtrack/validate-config.test.ts` with the seven mirrored cases asserting full-result `toEqual` contracts; verify the paired mutation measurement reaches ≥ 0.94; record the achieved score in the spec; leave `scripts/mutation/baseline.json` untouched for CI to ratchet.

## Consequences

### Positive

- `plugins/task-provider-youtrack/validate-config.ts` gains characterization over its entire surface: required/empty/whitespace rejection, malformed-URL rejection, and http/https protocol gating.
- Achieved paired score: killed=32, survived=0, noCoverage=0, score=1.0 — above the 0.94 floor and above the kaneo twin's 0.969, because the whitespace-only case killed the trim-removal mutant the twin leaves alive.
- The tests double as executable documentation of the baseUrl contract, including the exact `reason` strings surfaced to users.

### Negative

- Characterization tests pin behavior exactly; any deliberate change to validation semantics or reason strings requires updating the tests in the same change.
- The case set is duplicated with the kaneo twin (minus the whitespace case); keeping the twins in sync on future contract changes is manual.

### Risks

- If the paired runner's mirror-path resolution changes, the file could silently drop out of the mutation scope. Mitigation: the CI `mutation-baseline` ratchet would surface a floor regression.

## Implementation Notes

- The whitespace-only `'   '` case is the deliberate divergence from the kaneo twin; it kills the L12 `MethodExpression` trim-removal mutant.
- The http-localhost case (`http://localhost:3000`) kills the `'http:'` StringLiteral and its `!==`→`===` flip, which the https case cannot distinguish.
- The missing-key case (`{}`) kills the OptionalChaining mutant (`.trim()` on `undefined` throws) and the `??`→`&&` / fallback-literal mutants.
- Verified: `bun test tests/plugins/task-provider-youtrack/validate-config.test.ts` → 7 pass, 0 fail; paired run `bun test:mutate:file plugins/task-provider-youtrack/validate-config.ts` → killed=32 survived=0 noCoverage=0, score=1.0; `baseline.json` intentionally left untouched pending the CI `seedMerge` ratchet.
- The spec's `### Expected outcome` section records the achieved numbers while keeping the original prediction text intact.

## Implementation Status

Implemented. `tests/plugins/task-provider-youtrack/validate-config.test.ts` exists with all seven planned tests; `plugins/task-provider-youtrack/validate-config.ts` is unmodified; the spec carries the achieved-score line (killed=32, score=1.0); the test file runs green. Landed in commits `090a70d06` (test file) and `bac9573cf` (spec sync). The mutation floor ratchet is deferred to CI per the plan.

## Related Decisions

- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — defines the baseline mechanics (`seedMerge`, monotonic floor) this change defers the ratchet to.
- ADR-0334: Plugin Test Quality — Behavior-Only Mutation Survivors — sibling test-only mutation-coverage effort on YouTrack/Kaneo plugin files.
- ADR-0373: YouTrack Custom-Field-Values Mutation Coverage — same companion-file, test-only philosophy applied to a larger YouTrack module.

## References

- Spec: `docs/superpowers/specs/2026-08-04-youtrack-validate-config-mutation-design.md`
- Plan: `docs/superpowers/plans/2026-08-04-youtrack-validate-config-mutation.md`
- Source: `plugins/task-provider-youtrack/validate-config.ts`; tests: `tests/plugins/task-provider-youtrack/validate-config.test.ts`
