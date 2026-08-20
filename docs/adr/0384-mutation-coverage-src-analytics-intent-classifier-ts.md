<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0384: Mutation Coverage for `src/analytics/intent/classifier.ts` — Test-Only Companion Tests, Shipped

## Status

Accepted

## Date

2026-08-09

## Context

`docs/archive/2026-08-06-mutation-coverage-classifier.md` (paired spec `docs/archive/2026-08-06-mutation-coverage-classifier-design.md`) planned
a test-only mutation-coverage companion for `src/analytics/intent/classifier.ts`, whose paired
mutation score was 0 — the production code was correct but had no
characterization tests. The fix adds `tests/analytics/intent/classifier.test.ts` exercising the
module through its public surface, with the measured mutation score (not test
redness) as the quality gate; production code stays unmodified and the
baseline ratchets via CI.

## Decision Drivers

- **Test-only.** `src/analytics/intent/classifier.ts` and every other source file stay unmodified —
  no refactoring-for-testability.
- **Conventional companion path.** The paired mutation runner auto-discovers
  `tests/analytics/intent/classifier.test.ts`; no `scripts/mutation/overrides.json` edit is needed.
- **Quality gate is the measured mutation score**, not test redness —
  characterization tests pass immediately against correct code.
- **Baseline ratchets via CI** (`seedMerge`), not by hand.

## Decision

Archive the plan and spec as shipped. The companion test file landed on
master and the mutation baseline for `src/analytics/intent/classifier.ts` was ratcheted to
`0.9672727272727273` in commit `3d8bc3cd1`
(`chore(mutation): ratchet src/analytics/intent/classifier.ts baseline to 0.9672727272727273`), proving
the work shipped. Production code is unmodified.

## Consequences

### Positive

- `src/analytics/intent/classifier.ts` gains characterization coverage at paired score `0.9672727272727273`.
- Production code unmodified; the tests double as executable documentation of
  the module's contract.

### Negative
- Accepted residual mutants cap the file below 1.0; future score regressions
  must be triaged against the documented survivors, not assumed equivalent.
- Characterization tests pin current behavior; a deliberate semantic change
  requires updating the tests in the same change.

## Implementation Status

Implemented. Ratchet commit `3d8bc3cd1` bumped `src/analytics/intent/classifier.ts` baseline to
`0.9672727272727273` on master; the companion test file is present.

## References

- Plan: `docs/archive/2026-08-06-mutation-coverage-classifier.md`
- Spec: `docs/archive/2026-08-06-mutation-coverage-classifier-design.md`
- Source: `src/analytics/intent/classifier.ts`; tests: `tests/analytics/intent/classifier.test.ts`
- Ratchet: commit `3d8bc3cd1`
