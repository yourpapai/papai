<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0373: YouTrack Custom-Field-Values Mutation Coverage — Pure Unit-Test Companion File via Public Export, Five Accepted Residual Mutants

## Status

Accepted

## Date

2026-08-04

## Context

`plugins/task-provider-youtrack/custom-field-values.ts` had a paired mutation score of 0 (0 killed / 14 survived / 81 no-coverage of 95 mutants). The module maps YouTrack's polymorphic custom-field values onto papai's `TaskCustomField` shape: it filters non-generic field names (State, Priority, Assignee, the due-date field), passes primitives and null through, walks a `text` → `name` → `login` fallback ladder on objects, maps/filters arrays, and stringifies everything else with a `[complex value]` placeholder for unstringifiable input. None of this behavior had any test.

The production code is correct; the deficit is missing tests. The design spec (`docs/superpowers/specs/2026-08-04-youtrack-custom-field-values-mutation-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-04-youtrack-custom-field-values-mutation.md`) define the fix; this ADR records the decisions.

## Decision Drivers

- **Test-only change.** `plugins/task-provider-youtrack/custom-field-values.ts` and every other source file stay unmodified — no refactoring-for-testability.
- **Own the conventional companion path.** The paired mutation runner's test-resolver auto-discovers the mirror path `tests/plugins/task-provider-youtrack/custom-field-values.test.ts`; no `scripts/mutation/overrides.json` edit is needed.
- **Exercise private helpers only through the public export.** All assertions go through the single export `mapReadOnlyCustomFields`; the private `buildReadOnlyCustomFieldValue` ladder is reached by crafting `value` shapes on a generic field named `'Team'`. Private helpers are never imported.
- **Characterization tests that pass immediately.** The code is correct, so the tests are green on first run; the quality gate is the paired mutation score (≥ 0.9), not test redness.
- **Deep-equality assertions.** `toEqual` on the full returned array distinguishes `5` from `'5'`, kills `ObjectLiteral {}` mutants, and locks entry order; `toBeUndefined()` pins the empty-shape contract.
- **Document accepted residuals, never suppress.** Two equivalent mutants were predicted (L15 `isRecord` `&&`→`||`, L41 array null-guard `||`→`&&`); the achieved run recorded five survivors total at score 0.947. Anything unexpected is a missing assertion, not an assumed equivalent.
- **Baseline ratchets via CI, not by hand.** `scripts/mutation/baseline.json` is not edited; the master `mutation-baseline` job's `seedMerge` raises the floor post-merge (per repo precedent).

## Considered Options

### Option 1 — Companion test file asserting only through `mapReadOnlyCustomFields` (chosen)

Create `tests/plugins/task-provider-youtrack/custom-field-values.test.ts` with five describe blocks (filter/shape, primitive/null, object fallback ladder, array branch, stringify tail — 20 tests total). Fixtures use `$type: 'SimpleIssueCustomField'` for scalar cases and `$type: 'Custom'` (the unknown-shape fallback accepting `unknown`) for null/object/array/function/circular cases so everything typechecks without casts. No fetch mocks, no DI, no store.

- **Pros:** production code untouched; conventional mirror path satisfies the paired runner with zero config; public-export-only assertions make tests resilient to internal refactors; `$type: 'Custom'` fixtures kill the `value === null || value === undefined` `||`→`&&` mutant without type casts; quality gate is the measured mutation score.
- **Cons:** characterization tests offer no protection against intentional behavior changes (they lock current behavior, right or wrong); the accepted residual mutants permanently cap the file below 1.0.

### Option 2 — Export and test the private helpers directly (rejected)

Export `buildReadOnlyCustomFieldValue` (or the ladder/stringify helpers) and unit-test them in isolation.

- **Pros:** simpler fixtures per branch; no need to route every shape through the public filter.
- **Cons:** modifies production code purely to satisfy tests; widens the module's public surface for test convenience; locks in the current helper decomposition, discouraging future refactors.

### Option 3 — Fold coverage into an existing YouTrack plugin suite (rejected)

Extend an existing `tests/plugins/task-provider-youtrack/*` file with the mapping cases instead of creating the companion file.

- **Pros:** no new file.
- **Cons:** violates the mirror-path convention the paired runner and TDD hook rely on (`tests/plugins/.../custom-field-values.test.ts` for `plugins/.../custom-field-values.ts`); would require an `overrides.json` entry; mixes unrelated suites.

## Decision

Adopt Option 1. Ship the companion `tests/plugins/task-provider-youtrack/custom-field-values.test.ts` (20 tests across five describe blocks), asserting exclusively through `mapReadOnlyCustomFields` with full-array `toEqual` / `toBeUndefined` contracts; verify the paired mutation measurement reaches ≥ 0.9 with only documented equivalent survivors; record the achieved score in the spec; leave `scripts/mutation/baseline.json` untouched for CI to ratchet.

## Consequences

### Positive

- `plugins/task-provider-youtrack/custom-field-values.ts` gains characterization over its entire surface: exclusion filtering (State/Priority/Assignee/due-date), order preservation, null/missing-value mapping, primitive pass-through without stringification, the `text` → `name` → `login` ladder with non-string fall-through, array item mapping/filtering with login fallback, and the stringify tail including the `[complex value]` placeholder for functions and circular structures.
- Achieved paired score: killed=90, survived=5, noCoverage=0, score=0.947 — above the 0.9 target, with the two predicted equivalents among the survivors.
- The tests double as executable documentation of the value-mapping contract, including subtle points like `null` mapping to `null` (not the placeholder) and non-string object properties falling through to `JSON.stringify`.

### Negative

- The accepted residual mutants cap the file below 1.0 — future score regressions must be triaged against the documented survivor list, not assumed equivalent.
- Characterization tests pin behavior exactly; any deliberate change to mapping semantics requires updating the tests in the same change.
- `$type: 'Custom'` fixtures lean on the unknown-shape schema fallback; if `CustomFieldValueSchema` tightens its union, the fixtures may need to change even though production behavior is unaffected.

### Risks

- A future contributor may chase the accepted residual mutants. Mitigation: the plan and spec enumerate the predicted equivalents with line-level rationale (L15 `isRecord`, L41 array null-guard); this ADR records the acceptance.
- If the paired runner's mirror-path resolution changes, the file could silently drop out of the mutation scope. Mitigation: the CI `mutation-baseline` ratchet would surface a floor regression.

## Implementation Notes

- Fixtures: `$type: 'SimpleIssueCustomField'` for scalar/missing-value cases; `$type: 'Custom'` for `null`, object, array, function, and circular cases (accepts `unknown`, so `null` typechecks without a cast).
- The array test additionally asserts `toHaveLength(2)` on the filtered value to kill filter-predicate mutants that leave `undefined` entries; the circular fixture uses bracket-notation assignment to satisfy lint.
- Verified: `bun test tests/plugins/task-provider-youtrack/custom-field-values.test.ts` → 20 pass, 0 fail; paired run `bun test:mutate:file plugins/task-provider-youtrack/custom-field-values.ts` → killed=90 survived=5 noCoverage=0, score=0.947; `baseline.json` intentionally left untouched pending the CI `seedMerge` ratchet.
- The spec's `### Expected outcome` section records the achieved numbers while keeping the original prediction text intact.

## Implementation Status

Implemented. `tests/plugins/task-provider-youtrack/custom-field-values.test.ts` exists with all 20 planned tests across the five describe blocks; `plugins/task-provider-youtrack/custom-field-values.ts` is unmodified; the spec carries the achieved-score line; the test file runs green. The mutation floor ratchet is deferred to CI per the plan.

## Related Decisions

- ADR-0342: Mutation Gate Becomes a Pure Regression Ratchet — defines the baseline mechanics (`seedMerge`, monotonic floor) this change defers the ratchet to.
- ADR-0334: Plugin Test Quality — Behavior-Only Mutation Survivors — sibling test-only mutation-coverage effort on YouTrack/Kaneo plugin files.
- ADR-0368: Search-Memos Mutation Coverage — same companion-file, test-only philosophy on the `src/tools` surface.

## References

- Spec: `docs/superpowers/specs/2026-08-04-youtrack-custom-field-values-mutation-design.md`
- Plan: `docs/superpowers/plans/2026-08-04-youtrack-custom-field-values-mutation.md`
- Source: `plugins/task-provider-youtrack/custom-field-values.ts`; tests: `tests/plugins/task-provider-youtrack/custom-field-values.test.ts`
