<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0336: Update-Status Test-Quality Improvement — Schema-Refine Acceptance Tests as the Behavior-Only Precedent

## Status

Accepted

## Date

2026-07-25

## Context

`src/tools/update-status.ts` sat at a paired mutation score of **0.245** (`killed=12 survived=37 noCoverage=0`) under `bun test:mutate:file`. The survivor cluster decomposed into three groups:

1. **Schema-refine-logic survivors (~11)** — the `.refine()` "at least one updatable field" rule was tested only in the *rejection* direction ("validates at least one field is provided" asserts `false`). Mutants that weaken or invert the refine predicate survived because no test ever asserted that valid inputs are *accepted*.
2. **Log-payload survivors** — mutants inside structured log calls.
3. **Description-string / confirmation-branch survivors** — cosmetic user-facing text and a low-value branch.

The core question: which survivors are worth chasing, and with what mechanism? Log payloads and wording are not behavior; locking them into tests couples the suite to brittle, user-facing-irrelevant strings.

Source: plan `docs/superpowers/plans/2026-07-25-update-status-test-quality.md`; spec `docs/superpowers/specs/2026-07-25-update-status-test-quality-design.md`.

## Decision Drivers

- **No source changes.** `src/tools/update-status.ts` must not be modified; the improvement is pure test additions to `tests/tools/update-status.test.ts`.
- **Behavior-only assertions.** Chase only behaviorally testable survivors (the refine-logic cluster). Log-payload, description-string, and confirmation-branch mutants are accepted deliberately, not by oversight.
- **Existing harness, existing patterns.** Reuse `schemaValidates()` from `tests/utils/test-helpers.ts` (runs `inputSchema.safeParse`, which executes `.refine()`), `createMockProvider()`, and the one-`test(...)`-per-case style already in the file.
- **Never weaken validation.** If a new acceptance test fails, fix the test data, not the schema.
- **Document accepted survivors.** A single spec-mandated comment block above the new tests records which mutant classes are intentionally left alive, so future readers of raw Stryker output know the survivors are a decision, not a gap.

## Considered Options

### Option 1 — Schema-acceptance tests only (chosen)

Append 5 `test(...)` cases inside the existing `describe('makeUpdateStatusTool')` block: one per updatable field (`name`, `icon`, `color`, `isFinal`) asserting `schemaValidates(...) === true` with only that field set, plus one all-fields acceptance case. Add the spec-mandated comment documenting the accepted survivor classes.

- **Pros:** kills the entire ~11-mutant refine-logic cluster (score 0.245 → ~0.47); zero source churn; tests bind to the schema contract, not internals; minimal, reviewable diff (one file).
- **Cons:** score stays capped well below 100%; accepted survivors require the comment/spec indirection to interpret.

### Option 2 — Option B: delayed-import + tracked-logger log assertions (rejected)

Restructure the suite with `mock.module()` and delayed imports so log payloads can be asserted, killing the log-payload survivors too.

- **Pros:** higher raw mutation score.
- **Cons:** locks brittle structured-log shapes into tests — every metadata tweak churns the suite; forces a legacy delayed-import restructure of a stable DI-first file; explicitly rejected by the spec as low-value coupling for cosmetic gain.

### Option 3 — Option C: description/message-string assertions (rejected)

Assert on tool description text and confirmation-branch message strings.

- **Pros:** kills the remaining cosmetic mutants.
- **Cons:** pins user-facing wording to tests; every copy edit breaks the suite; zero behavior protection gained.

## Decision

Adopt Option 1. Append 5 schema-acceptance tests (per-field + all-fields) and the spec-mandated comment to `tests/tools/update-status.test.ts`, immediately after the "validates at least one field is provided" rejection test. Log-payload, description-string, and confirmation-branch mutants remain accepted survivors. No other files change.

## Rationale

- The `.refine()` predicate is behavior: a mutant that inverts it accepts empty updates or rejects valid ones. The rejection-only test covered half the truth table; the 5 acceptance tests cover the other half and kill the cluster.
- `schemaValidates()` runs `safeParse`, so `.refine()` executes — the acceptance tests exercise the real refine path without invoking the provider.
- Refusing to chase log/string mutants keeps the suite refactor-resilient: wording and log metadata can evolve without test churn. The accepted-survivor comment makes the cap self-documenting.
- Pure test additions to one file keep the change atomic and the ratchet baseline (`scripts/mutation/baseline.json`) monotonic.

## Consequences

### Positive

- Paired mutation score target: ~0.47 (survivors reduced by ~11, from 37 to ~26).
- The `.refine()` "at least one field" rule is now truth-table-complete in tests: rejection and acceptance directions both pinned.
- Established the **behavior-only survivor-killing precedent** (Option A) that ADR-0334 (plugin test-quality) and later mutation-improvement work explicitly mirror.
- Only `tests/tools/update-status.test.ts` changed; the file passes (13 tests at verification: 8 pre-existing + 5 new).

### Negative

- The file's score is permanently capped below 100% by the accepted survivor classes; interpreting raw Stryker output requires the spec/comment indirection.
- One spec-mandated comment block is the sanctioned exception to the repo's no-comments convention.

### Risks

- If the schema's updatable-field set grows, the per-field acceptance tests must grow with it or the refine cluster partially revives — mitigated by the monotonic ratchet baseline in `scripts/mutation/baseline.json` catching score regressions.
- Future contributors may read the capped score as a gap and attempt Option B/C — mitigated by the in-file comment pointing at the spec.

## Implementation Status

Implemented. `tests/tools/update-status.test.ts:132-172` contains the spec-mandated comment and all 5 acceptance tests exactly as planned ("accepts input with only name set", "only icon set", "only color set", "only isFinal set", "all updatable fields"), inserted after the "validates at least one field is provided" test at `tests/tools/update-status.test.ts:126-130`. `src/tools/update-status.ts` unchanged. `bun test tests/tools/update-status.test.ts` → 13 pass, 0 fail (verified 2026-08-08).

## Related Decisions

- ADR-0334: Plugin Test-Quality Improvement — Behavior-Only Mutation Survivor Killing via Indirect Boundary Tests and Paired-Runner Overrides — the sibling work that mirrors this ADR's Option A precedent.
- ADR-0328: Stryker TypeScript-Checker Drop / TS7 Unblock — adjacent paired-mutation infrastructure work.

## References

- Plan: `docs/superpowers/plans/2026-07-25-update-status-test-quality.md`
- Spec: `docs/superpowers/specs/2026-07-25-update-status-test-quality-design.md`
- Code: `tests/tools/update-status.test.ts`, `src/tools/update-status.ts`, `scripts/mutation/baseline.json`
