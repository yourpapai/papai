<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan: mutation coverage for `review-loop/src/summary-burndown.ts`

Spec: `docs/superpowers/specs/2026-08-07-mutation-coverage-summary-burndown-design.md`
Target: measured **0.74 → 0.96**; killable gap = classes A–D (mutant ids
3, 5, 9, 15, 16, 17, 18, 19, 24, 25, 27 — eleven mutants); accepted residuals = ids 12, 33.

## Global constraints

- **Tests-only.** Edit only `tests/review-loop/summary-burndown.test.ts` plus this
  spec/plan. Never touch `src/`, `client/`, `plugins/`, `scripts/`,
  `review-loop/src/`, or `scripts/mutation/baseline.json`.
- **Exact equality only.** Every new assertion is `toBe(...)` on the full, knowable
  `burndownBlock` output string — no `startsWith`/`endsWith`/`toContain`.
- **One test per killable mutant class** (A–D). Tests may incidentally kill additional
  mutants; that is acceptable.
- **Ground every expected string in the real formatter.** Expected block strings were
  captured by running the production `burndownBlock` against the designed fixtures.
- Follow the file's existing conventions: `bun:test`, `.js` import paths, the
  `zeroMetric`/`busyMetric` helper style, no comments, BUSL-1.1 header already present.

## Tasks

- [ ] **A — kill the zero-total guard (ids 3, 5).** Add a test asserting the exact
      block for a round with `newIssues = 2`, all decisions zero, so `avgFix` is `-`.
- [ ] **B — kill the critical multiplier (id 9).** Add a test asserting the exact block
      for a round with `reviewerSeverity = { critical: 1 }`, `newIssues = 1`, so `avgRev`
      is `4.0`.
- [ ] **C — kill the decidedCount addends (ids 15, 16, 17, 18, 19).** Add a test asserting
      the exact block for a round with **all seven decision fields = 1** and
      `fixerSeverity = { medium: 7 }`, so `decidedCount = 7` and `avgFix = 2.0`; each
      `+addend → -addend` mutant lowers `decidedCount` to 5 (`avgFix = 2.8`).
- [ ] **D — kill the rowIsZero short-circuit (ids 24, 25, 27).** Add a test asserting
      the exact two-row block for `[round11 {newIssues=1, decidedCount=0},
      round12 {newIssues=0, decidedCount=2}]`.
- [ ] **Verify green.** `bun test tests/review-loop/summary-burndown.test.ts` passes.
- [ ] **Re-measure.** `bun test:mutate:file review-loop/src/summary-burndown.ts` shows
      survivors == {12, 33} and score = 0.96 (≥ 0.9); if any unexpected id survives, add a
      targeted test (if killable) or justify it as a residual.
- [ ] **Declare residuals.** Write `result.json` with residual mutantIds == measured
      survivors, exactly.
