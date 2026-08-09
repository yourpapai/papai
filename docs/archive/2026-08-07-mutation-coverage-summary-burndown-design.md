<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `review-loop/src/summary-burndown.ts`

## Summary

Raise the Stryker mutation score of `review-loop/src/summary-burndown.ts` from the
measured baseline **0.74** (the value pinned in `scripts/mutation/baseline.json`) to
**0.96** by adding four focused, exact-equality assertions to the existing companion test
`tests/review-loop/summary-burndown.test.ts`. Eleven of the thirteen currently surviving
mutants are behaviorally observable through `burndownBlock`'s output and are killed by the
new tests. The remaining two are provably **equivalent** (a multiply/divide by the weight
`1`, and a `padEnd(0)` no-op) and are declared as accepted residuals.

This is a **tests-only** change: no file under `src/`, `client/`, `plugins/`,
`scripts/`, or `review-loop/src/` is touched.

## Why this file

`summary-burndown.ts` renders the ASCII burndown table appended to every review-loop run
transcript. It is a pure, side-effect-free formatter whose entire public surface is the
string returned by `burndownBlock` — so every observable behavior is reachable through
exact string assertions. It was the lowest-scored review-loop source in the ratchet and is
the ideal candidate for full behavioral coverage.

## Non-goals

- Refactoring `summary-burndown.ts` (no `src/` edits; this iteration is test-only).
- Killing the two equivalent mutants declared as residuals — they cannot be killed without
  changing production code.
- Covering `trace-log.ts` types or other review-loop modules.
- Changing `scripts/mutation/baseline.json` (the runner owns the ratchet).

## Gap analysis

Measured against the **unmodified** companion test
(`git checkout HEAD -- tests/review-loop/summary-burndown.test.ts`, then
`bun test:mutate:file review-loop/src/summary-burndown.ts`, report
`reports/paired/review-loop__src__summary-burndown.ts.stryker-report.json`):
`killed=37 survived=12 noCoverage=1 pending=0 score=0.74` (scored=50).

Every Survived/NoCoverage mutant, grouped into behavioral classes:

| Class | Mutant ids | Loc | Mutator | Original → Mutated | Why it survives today |
|---|---|---|---|---|---|
| **A. avgSeverity zero-total guard** | 3 | L27 | ConditionalExpression | `if (total === 0) return '-'` → condition `false` | No fixture drives `avgSeverity(_, 0)`, so the guard is dead in the suite; forcing it off is invisible. |
| | 5 | L27 | StringLiteral (NoCoverage) | `'-'` → `""` | Same dead branch: the `'-'` literal has zero execution coverage. |
| **B. SEV_WEIGHT critical multiplier** | 9 | L29 | ArithmeticOperator | `counts.critical * SEV_WEIGHT.critical` → `/` | The sole fixture (`busyMetric`) has `critical = 0` in both severity sets, so `0*4 === 0/4`. |
| **C. decidedCount sum addends** | 19 | L40 | ArithmeticOperator | `… + m.decisions.already_fixed` → `-` | `busyMetric` has `already_fixed = 0`, so `+0 === -0`. |
| | 18 | L41 | ArithmeticOperator | `… + m.decisions.needs_human` → `-` | `needs_human = 0` ⇒ `+0 === -0`. |
| | 17 | L42 | ArithmeticOperator | `… + m.decisions.plan_drift` → `-` | `plan_drift = 0` ⇒ `+0 === -0`. |
| | 16 | L43 | ArithmeticOperator | `… + m.decisions.no_commit` → `-` | `no_commit = 0` ⇒ `+0 === -0`. |
| | 15 | L44 | ArithmeticOperator | `… + m.decisions.inspector_rejected` → `-` | `inspector_rejected = 0` ⇒ `+0 === -0`. |
| **D. rowIsZero short-circuit** | 25 | L49 | ConditionalExpression | `m.newIssues === 0` → `true` | No fixture has `newIssues > 0 && decidedCount === 0`, so flipping the left operand never changes the kept/dropped decision. |
| | 27 | L49 | ConditionalExpression | `decidedCount(m) === 0` → `true` | No fixture has `newIssues === 0 && decidedCount > 0`, so flipping the right operand never changes the decision. |
| | 24 | L49 | LogicalOperator | `&&` → `\|\|` | Both fixtures are either fully zero or fully non-zero, so `a && b` and `a \|\| b` agree. |
| **E. SEV_WEIGHT low multiplier (equivalent)** | 12 | L32 | ArithmeticOperator | `counts.low * SEV_WEIGHT.low` → `/` | `SEV_WEIGHT.low === 1`, so `low*1 === low/1` for every integer. **Accepted residual.** |
| **F. renderRow width guard (equivalent)** | 33 | L56 | ConditionalExpression | `width === 0 ? value : value.padEnd(width)` → condition `false` | Forcing the guard off routes the `width === 0` column through `value.padEnd(0)`, and `padEnd(0)` is the identity for every string; non-zero columns already take the `padEnd` branch. **Accepted residual.** |

Classes **A–D** (ids 3, 5, 9, 15, 16, 17, 18, 19, 24, 25, 27 — eleven mutants) are the
killable gaps; classes **E–F** (ids 12, 33) are the accepted residuals.

## Design — tests to add

All new assertions use **exact `toBe(...)` equality** on the full `burndownBlock` output
string (the entire rendered block), which is fully knowable for a deterministic formatter.
One test per killable class; each fixture is constructed so the targeted mutator class
changes exactly one cell (or one row's presence) of the output, making the exact-match
assertion fail under the mutant.

- **Test A → Class A (ids 3, 5).** Round 3 with `newIssues = 2`, all decisions zero
  (`decidedCount = 0`), so the row is kept (`newIssues > 0`) and
  `avgFix = avgSeverity(fixerSeverity, 0)` exercises the `total === 0` guard and the `'-'`
  literal. Mutant 3 forces the guard off → `0/0 = "NaN"`; mutant 5 returns `""`; both
  differ from the expected `-` cell.
- **Test B → Class B (id 9).** Round 5 with `reviewerSeverity = { critical: 1 }` and
  `newIssues = 1`, so `avgRev = (1*4)/1 = 4.0`. Mutant 9 swaps `*4`→`/4` (≈`0.3`), ≠ `4.0`.
- **Test C → Class C (ids 15, 16, 17, 18, 19).** Round 7 with **all seven decision fields
  set to 1** (`decidedCount = 7`) and `fixerSeverity = { medium: 7 }` →
  `avgFix = (7*2)/7 = 2.0`. Each `+addend → -addend` mutant reduces `decidedCount` to 5,
  giving `avgFix = 14/5 = 2.8`, ≠ `2.0`. Setting every addend nonzero covers all five
  surviving operators at once.
- **Test D → Class D (ids 24, 25, 27).** Two rounds in one block: round 11 with
  `newIssues = 1, decidedCount = 0`, and round 12 with `newIssues = 0, decidedCount = 2`
  (decisions `fixed = 2`). Each survivor drops a different subset of rows: id 25 drops
  round 11, id 27 drops round 12, id 24 drops both. Asserting the full two-row block fails
  under any row loss.

## Verification

1. `bun test tests/review-loop/summary-burndown.test.ts` → 7 pass, 0 fail
   (3 existing + 4 new).
2. `bun test:mutate:file review-loop/src/summary-burndown.ts` reports
   `killed=48 survived=2 noCoverage=0 score=0.96`, with the only survivors being ids
   **12** and **33** — exactly the accepted residuals.
3. The build gate `CI=true bun check:full` is unaffected (tests-only diff).

## Accepted residuals

- **id 12 — `counts.low * SEV_WEIGHT.low` → `/` (L32).** `SEV_WEIGHT.low === 1`, hence
  `low * 1 === low / 1` for every non-negative integer count. No input can distinguish the
  mutant from the original; it is mathematically equivalent. Killing it would require a
  `src/` change (e.g. a non-unit low weight), out of scope.
- **id 33 — `width === 0 ? value : value.padEnd(width)` condition → `false` (L56).**
  Forcing the guard off routes the `width === 0` column through `value.padEnd(0)`, and
  `String.prototype.padEnd(0)` is the identity for every string (ECMA-262: when
  `targetLength ≤ string.length`, the original is returned). Non-zero-width columns already
  evaluate to the `padEnd` branch. The mutant is output-identical for all inputs.
  Eliminating it would need a `src/` change to the WIDTHS/padding model, out of scope.
