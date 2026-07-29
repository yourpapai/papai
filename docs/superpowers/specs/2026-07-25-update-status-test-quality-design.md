<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# update-status.ts test-quality improvement — design

Date: 2026-07-25
Status: approved (design), pending implementation plan

## Problem

`src/tools/update-status.ts` scores **24.5%** under the paired mutation runner
(`bun test:mutate:file src/tools/update-status.ts`): 12 killed / 37 survived /
49 total. The survivor analysis (`reports/paired/src__tools__update-status.ts.stryker-report.json`)
groups the 37 into five clusters:

| Cluster | Location | # | Why they survive |
|---|---|---|---|
| **G1 — schema *refine* logic** | lines 28-32 | 11 | The `.refine()` "at least one field" rule is only tested for **rejection** (`tests/tools/update-status.test.ts:126-130`). No test asserts valid input is **accepted**, so every mutation of the predicate survives. |
| **G2 — log payloads** | lines 13, 37, 40, 44, 45, 48, 50 | 9 | `mockLogger()` mocks logging; no test asserts log payloads. (Line 45's `instanceof Error ? … : String(error)` ternary is log-only too — it only sets the log `error` field; `throw error` is unchanged.) |
| **G3 — confirmation branch** | line 36 | 8 | Both the `if` and the fall-through `return result`; the only observable difference is `log.warn` vs `log.info`. |
| **G5 — cosmetic strings** | lines 19-26 (field `.describe()`), 31 (refine msg), 19 (schema `ObjectLiteral`) | 9 | LLM-contract / validation message strings; the `ObjectLiteral` mutant survives because the refine acts as a backstop (empty object schema strips all keys, refine still rejects). |

### Key constraint

`src/tools/update-status.ts:13` calls `logger.child(...)` at **module top-level**.
The test imports the source before `beforeEach`'s `mockLogger()` runs, so the
in-execute `log.info`/`log.warn` calls hit the real logger, not the mock.
Killing G2/G3 therefore requires restructuring the test to a delayed-import +
`createTrackedLoggerMock()` pattern (the `tests/AGENTS.md` delayed-import convention).

## Approaches considered

| | Approach | Killable mutants | Score | Trade-off |
|---|---|---|---|---|
| **A** | **Behavior-only**: add schema *acceptance* tests for G1 | 11 | ~47% | Pure additive tests; no restructure. Caps at G1 because G2/G3 are log-only. |
| **B** | **A + log assertions**: delayed-import + tracked logger, assert log payloads | 11 + ~17 | ~80% | Couples tests to exact log strings (brittle); test restructure. |
| **C** | **Maximize**: also assert field `.describe()` strings + module-level `child` scope | all but equivalent | ~90%+ | Most brittle; asserts static LLM-contract cosmetics. |

## Accepted approach: A — behavior-only

It captures the one genuine **behavioral** gap (the refine rule is never verified
in the positive direction) with cheap, robust, additive tests. Every remaining
survivor is either **log-equivalent** — the code's observable behavior is already
tested; only the log side-effect differs — or a cosmetic string. Killing those
would couple tests to exact log/message strings, against the repo's
"mutation as quality signal, not maximization" stance (`AGENTS.md`).

The score ceiling under behavior-only is ~47% (23/49), nearly 2× the current
24.5%. G3 (and the line-45 ternary inside G2) were initially hypothesized as
behavior-killable but analysis showed they are log-only (return value and
rethrow are identical regardless of branch).

## Changes (1 file, pure additions)

**`tests/tools/update-status.test.ts`** — add 5 schema-acceptance tests inside
the existing `describe('makeUpdateStatusTool')`. Each uses the existing
`schemaValidates` helper (which runs `inputSchema.safeParse`, including `.refine()`).
All inputs include the required `projectId` + `statusId` plus the one under test.

- `accepts input with only name set` → `schemaValidates(tool, { projectId: 'p', statusId: 's', name: 'n' }) === true`
- `accepts input with only icon set` → `…, icon: 'i'`
- `accepts input with only color set` → `…, color: '#fff'`
- `accepts input with only isFinal set` → `…, isFinal: true`
- `accepts input with all updatable fields` → name + icon + color + isFinal

**Mutants killed by these tests** (11):
- The whole-predicate `ArrowFunction → () => undefined` (mutant 13) — any
  accepted input kills it.
- The four per-field `ConditionalExpression → false` mutants (`name`, `icon`,
  `color`, `isFinal` conditions) — each per-field-alone test kills its own.
- The three `LogicalOperator || → &&` mutants — each is killed by the
  single-field test whose field sits on the left operand (name-only kills the
  first, icon-only kills the second, color-only kills the third).
- The "all fields" test is a readable positive case and belt-and-suspenders for
  the predicate mutant.

No source changes. No restructuring of existing tests.

## Accepted survivors (documented, not killed)

- **G2 (log payloads, incl. line 45 ternary) + G3 (line 36 confirmation branch)** —
  log-only; require delayed-import + tracked-logger + log-string assertions (Option B).
- **G5 (field `.describe()` strings, refine message, schema `ObjectLiteral`,
  module-level `logger.child`)** — cosmetic / LLM-contract / module-load config.

A one-line comment at the top of the new test group notes that log/description
mutants are intentionally accepted (with a pointer to this spec), so a future
higher score bar knows it means moving to Option B.

## Error handling

- If a new acceptance test unexpectedly returns `false`, the refine predicate is
  stricter than documented — fix the test data, do not weaken the schema.
- If `bun test:mutate:file` reports *fewer* than 11 newly-killed mutants, a
  mutant category was mis-assumed — re-read the survivor diff and extend the
  per-field tests before declaring done.

## Testing / verification

- `bun test tests/tools/update-status.test.ts` — green (existing 7 + new 5).
- `bun test:mutate:file src/tools/update-status.ts` — score rises to ~47%
  (23/49); survivors drop from 37 to ~26.
- `bun run lint`, `bun run typecheck` — green (test-only change; no schema impact).

## Out of scope

Source changes to `update-status.ts`, log-payload assertions (Option B),
description/message-string assertions (Option C), and any other tool's tests.
