<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — Mutation Coverage for `review-loop/src/summary.ts`

## Goal

Raise mutation score from 0.7732 to 0.9888 by adding 18 exact-equality tests to
`tests/review-loop/summary.test.ts`.

## Global constraints

- Test-only: no edits under `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Every new assertion uses `toBe` — no `startsWith` / `endsWith` / `toContain`
  matchers.
- One test per mutant class (17 classes → 17 tests).
- Special characters (—, ·, …, ✓) copied verbatim from source output.
- `bun test tests/review-loop/summary.test.ts` must be green before finishing.

## Tasks

- [ ] **T1 — alreadyFixed counting** (ids 26, 27, 28, 57, 60)
      Ledger with `already_fixed` record → assert verdict line exactly.
- [ ] **T2 — zero-fixed suppression** (ids 41, 43)
      Rejected-only ledger → assert done verdict has no "0 fixed".
- [ ] **T3 — empty breakdown suffix** (ids 69, 71, 72)
      Verified-only ledger → assert "1 open." with no parenthetical suffix.
- [ ] **T4 — sumDecisions + decision keys** (ids 83, 84, 85, 260, 261, 262)
      Two metrics with distinct decision values → assert exact totals.
- [ ] **T5 — exact minimal summary** (ids 116, 118, 193, 227, 230, 233, 238, 241, 244, 246)
      `inputOf()` → `toBe` on the full 5-line summary string.
- [ ] **T6 — multi-phase join separator** (id 119)
      Two nonzero phases → assert timing breakdown uses ", ".
- [ ] **T7 — rounds pool suppression** (ids 138, 140, 143)
      rounds=3, poolSize=1 → assert exact "Rounds: 3" (no Pool).
- [ ] **T8 — inspector rendering** (ids 145-159, 231, 232)
      inspect=true, runs=4, rejected=2 → assert exact inspector line. Plus
      inspect=true, runs=0 → assert no inspector line (kills id 152).
- [ ] **T9 — inspect guard** (id 148)
      inspect=false with inspector data → assert exact minimal summary (no inspector line).
- [ ] **T10 — stats removed-only** (id 176)
      added=0, removed=7 → assert "Stats: +0/-7".
- [ ] **T11 — issues header + separator** (ids 198, 199, 240)
      One closed issue → assert blank separator + "Issues:" header.
- [ ] **T12 — burndown separator** (id 245)
      Busy metric → assert blank line precedes "Burndown:".
- [ ] **T13 — group cap boundary** (ids 213, 215)
      Exactly 20 records → assert 20 issue lines, 0 overflow lines.
- [ ] **T14 — metricsJson open** (ids 250, 252, 253, 254)
      Last metric cumulativeOpen=5 → assert `totals.open` is 5.
- [ ] **T15 — metricsJson burndown copy** (id 258)
      Two metrics → assert `burndown.length` is 2.
- [ ] **T16 — metricsJson inspectorRejected** (ids 263, 264)
      Inspector data → assert `totals.inspectorRejected` is 2.
- [ ] **T17 — metricsJson runStats key** (id 266)
      No runStats arg → assert `'runStats' in json` is false.
- [ ] **Verify** — run `bun test tests/review-loop/summary.test.ts` green.
- [ ] **Residuals** — declare ids 206 (dead code) and 251 (mathematically equivalent).

## Accepted residuals

- **206** — `groupRecords.length === 0` is unreachable (Map arrays always have ≥1 element).
- **249** — `metrics.length > 0` → `true` (ConditionalExpression): `metrics[-1]` is `undefined` for empty arrays, same as the original false branch.
- **251** — `metrics.length >= 0` produces the same ternary result as `> 0` (`metrics[-1]` is `undefined`).
