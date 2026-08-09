<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage Improvement — `review-loop/src/summary.ts`

## Summary

Extend the companion test file `tests/review-loop/summary.test.ts` with exact-equality
assertions that kill 60 of the 61 surviving mutants in `review-loop/src/summary.ts`,
raising the mutation score from 0.7732 to 0.9888. Three mutants are accepted as
equivalent residuals (dead-code condition + mathematically equivalent operators).

## Why this file

`summary.ts` produces the human-readable end-of-run summary and the `metrics.json`
payload for the review-loop runner. It is pure formatting/aggregation logic with no
side effects, making it ideal for exhaustive output-diff testing. The baseline score
(0.7732) is far below the 0.9 threshold, and every surviving mutant is either a
formatting detail not yet exercised (inspector line, already-fixed breakdown,
multi-phase join, structural separators) or a numeric aggregation not yet asserted
(sumDecisions, open-from-last-metric, inspector-rejected sum).

## Non-goals

- Editing anything under `src/`, `client/`, `plugins/`, or `scripts/`.
- Editing `scripts/mutation/baseline.json` (the runner owns it).
- Refactoring `summary.ts` — the file is correct; only test coverage is missing.
- Killing the three equivalent residuals (id 206, 249, 251) — they are genuinely
  unkillable via tests (see Accepted Residuals).

## Gap analysis

Measured: `bun test:mutate:file review-loop/src/summary.ts` → killed=208 survived=58
noCoverage=3, score=0.7732 (269 total mutants).

| # | Gap class (mutant IDs) | Location | Why it survives | Test to add |
|---|------------------------|----------|-----------------|-------------|
| 1 | alreadyFixed counting (26, 27, 28, 57, 60) | `countIssues` L83 + `breakdownParts` L103 | No test exercises `already_fixed` status | Ledger with already_fixed record → done verdict |
| 2 | zero-fixed suppression (41, 43) | `breakdownParts` L100 `counts.fixed > 0` | Existing done-test always has fixed > 0 | Rejected-only ledger → "1 rejected" (no "0 fixed") |
| 3 | empty breakdown suffix (69, 71, 72) | `buildVerdict` L110 `breakdown === ''` | No test with open-only ledger (empty breakdown) | Verified-only ledger → "1 open." (no suffix) |
| 4 | sumDecisions + decision keys (83, 84, 85, 260, 261, 262) | `sumDecisions` L119-121 + L269-271 | `buildMetricsJson` tests never assert totals.rejected/alreadyFixed/needsHuman | Multi-round metrics → assert exact decision sums |
| 5 | minimal structure + null guards (116, 118, 193, 227, 230, 233, 238, 241, 244, 246) | `buildTimingLine` L157 + `buildSummary` L227-246 | No test asserts the full exact minimal summary string | `toBe` on full 5-line summary for `inputOf()` |
| 6 | phase join separator (119) | `buildTimingLine` L157 `parts.join(', ')` | Existing timing tests use single-phase metric | Two nonzero phases → comma-separated breakdown |
| 7 | rounds pool suppression (138, 140, 143) | `buildRoundsLine` L166 `poolSize > 1` | Existing test uses `toContain('Rounds: 2')` (too loose) | rounds=3, poolSize=1 → exact "Rounds: 3" |
| 8 | inspector rendering (145-159, 231, 232) | `buildInspectorLine` L170-177 + `buildSummary` L234 | No test enables inspect with inspector runs | inspect=true, runs=4, rejected=2 → exact inspector line; plus inspect=true, runs=0 → no inspector line (kills id 152 `runs===0`→`false`) |
| 9 | inspect guard (148) | `buildInspectorLine` L171 `!options.inspect` | No test with inspect=false + inspector data | inspect=false, runs>0 → no inspector line (exact minimal) |
| 10 | stats removed-only (176) | `buildStatsLine` L184 `t.removed > 0` | Existing stats tests always have added > 0 | added=0, removed=7 → "Stats: +0/-7" |
| 11 | issues header + separator (198, 199, 240) | `issuesBlock` L198 + `buildSummary` L240 | Existing issue tests check group lines, not the "Issues:" header or separator | Ledger with closed issue → assert header + blank separator |
| 12 | burndown separator (245) | `buildSummary` L243 push arg | No test checks the blank line before burndown | busy metric → assert `''` precedes "Burndown:" |
| 13 | group cap boundary (213, 215) | `issuesBlock` L214 `> GROUP_CAP` | Only 21-record test exists (off-by-one not distinguished) | Exactly 20 records → no overflow note |
| 14 | metricsJson open (250, 252, 253, 254) | `buildMetricsJson` L257-258 | Tests never assert `totals.open` | Multi-metric → assert open from last metric |
| 15 | metricsJson burndown copy (258) | `buildMetricsJson` L263 | Tests never assert `burndown` length | Two metrics → burndown length 2 |
| 16 | metricsJson inspectorRejected (263, 264) | `buildMetricsJson` L273 | Tests never assert `totals.inspectorRejected` | Metric with inspector data → assert exact count |
| 17 | metricsJson runStats key (266) | `buildMetricsJson` L275 | No test checks runStats key absence | No runStats arg → `'runStats' in json === false` |

## Design — tests to add

All 17 tests extend `tests/review-loop/summary.test.ts`. Each maps one-to-one onto a
gap class above. Every assertion uses `toBe` (exact equality) — no
`startsWith`/`endsWith`/`toContain` matchers.

1. **alreadyFixed verdict** — `ledgerOf(makeRecord('already_fixed'))` → assert
   `lines[0]` is `'Review loop finished: done — 1 issue: 1 already fixed.'`
2. **zero-fixed suppression** — `ledgerOf(makeRecord('rejected'))` → assert
   `lines[0]` is `'Review loop finished: done — 1 issue: 1 rejected.'`
3. **empty breakdown suffix** — `ledgerOf(makeRecord('verified'))` → assert
   `lines[0]` is `'Review loop finished: issues remaining — 1 open.'`
4. **sumDecisions** — two metrics with different decision values → assert
   `json.totals.rejected`, `.alreadyFixed`, `.needsHuman` are exact sums.
5. **exact minimal summary** — `buildSummary(inputOf())` → `toBe` on the full
   5-line string (verdict + timing + blank + artifacts header + artifacts list).
6. **multi-phase join** — metric with review + fix nonzero → assert timing line has
   `(review 1.0s, fix 2.0s)`.
7. **rounds no pool** — `rounds: 3`, `poolSize: 1` → assert `lines[2]` is
   `'Rounds: 3'`.
8. **inspector line** — `inspect: true`, runs=4, rejected=2 → assert `lines[2]` is
   `'Inspector: 4 runs, 2 rejected (50.0% reject rate)'`.
9. **inspect disabled** — `inspect: false`, inspector data present → assert full
   minimal summary (no inspector line appears).
10. **stats removed-only** — `added: 0, removed: 7` → assert `lines[2]` is
    `'Stats: +0/-7'`.
11. **issues header + separator** — one closed issue → assert `lines[2]` is `''`
    and `lines[3]` is `'Issues:'`.
12. **burndown separator** — busy metric → assert the line before `'Burndown:'` is
    `''`.
13. **group cap boundary** — exactly 20 needs_human records → assert 20 bang lines
    and zero overflow lines.
14. **metricsJson open** — two metrics, last has `cumulativeOpen: 5` → assert
    `json.totals.open` is `5`.
15. **metricsJson burndown** — two metrics → assert `json.burndown.length` is `2`.
16. **metricsJson inspectorRejected** — metric with inspector data → assert
    `json.totals.inspectorRejected` is `2`.
17. **metricsJson runStats key** — no runStats arg → assert `'runStats' in json` is
    `false`.

## Verification

```
bun test tests/review-loop/summary.test.ts        # green
bun test:mutate:file review-loop/src/summary.ts    # score >= 0.9
```

Expected post-improvement score: **0.9888** (266/269 killed, 3 equivalent residuals).

## Accepted residuals

| Mutant ID | Location | Reason |
|-----------|----------|--------|
| 206 | `issuesBlock` L201 `groupRecords.length === 0` → `false` | Dead code: the `groups` Map only stores arrays with ≥1 element, so `groupRecords.length === 0` is unreachable when `groupRecords` is defined. The `undefined` check on the same line is the real guard. |
| 249 | `buildMetricsJson` L257 `metrics.length > 0` → `true` (ConditionalExpression) | Mathematically equivalent: when the ternary is forced to the true branch with an empty array, `metrics[-1]` evaluates to `undefined` — the same value the original false branch produces. For non-empty arrays both branches return the last element. |
| 251 | `buildMetricsJson` L257 `metrics.length > 0` → `>= 0` (EqualityOperator) | Mathematically equivalent: `metrics.length >= 0` is always true, but when length is 0, `metrics[-1]` evaluates to `undefined` — the same value the original ternary produces via the false branch. For non-empty arrays both branches return the last element. |
