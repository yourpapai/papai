<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `review-loop/src/live-format.ts` Design

**Date:** 2026-08-06
**Status:** Test-only improvement (no source changes)
**Target file:** `review-loop/src/live-format.ts`
**Companion test:** `tests/review-loop/live-format.test.ts`
**Score formula:** `(killed + timeout) / (killed + survived + noCoverage + timeout)` (see `scripts/mutation/score-merger.ts`)

## Summary

`review-loop/src/live-format.ts` is a pure formatting module (durations, tool args,
live status lines, token counts, activity summaries) for the review-loop live renderer.
The paired mutation run reports a **0.75** score (117 killed / 156 total; 37 survived,
2 no-coverage). This spec adds **exact-equality** assertions to the companion test file
that kill 35 of the 37 surviving mutants and exercise both no-coverage mutants, raising
the score to **154/156 = 0.9872** (verified). Two mutants on L64 (`id 78` condition
`filePath === ""` → `false`, and `id 80` the compared literal `""` → `"Stryker was
here"`) are accepted as equivalent residuals.

## Why this file

`live-format.ts` is small (120 lines), fully pure, fully deterministic, and already has
a companion test — yet its mutation score is low because the existing tests assert shape
via `toContain`/`toHaveLength` rather than full exact strings, and several branches
(`truncate`, `activitySummary`, switch-case routing, type guards) are only exercised on
the "happy" input. Pure formatting functions are the ideal target for exact-string
mutation kills: every output is fully knowable, so every surviving mutant is either a
genuine gap in the asserted string or an equivalent.

## Non-goals

- **No changes to `src/`, `client/`, `plugins/`, `scripts/`, or `review-loop/src/`.** The
  source module is correct; only the companion test gains assertions.
- **No change to `scripts/mutation/baseline.json`** (the runner owns it).
- **No new test files.** All new assertions live in the existing
  `tests/review-loop/live-format.test.ts`.
- **No loosening** of existing assertions. New assertions are `toBe(...)` exact only.
- **No attempt to kill the two equivalent mutants (`id 78`, `id 80`)** — see Accepted residuals.

## Gap analysis

Measured from the fresh paired report
`reports/paired/review-loop__src__live-format.ts.stryker-report.json` (156 mutants:
117 Killed, 37 Survived, 2 NoCoverage). Survivors grouped into classes; one row per
class. `id`s are Stryker mutant ids; line refs are `live-format.ts`.

| # | Gap class (surviving mutant ids) | Location | Mutator / replacement | Why it survives | Killed by (test) |
|---|---|---|---|---|---|
| 1 | `formatDuration` 60s boundary (10) | L16 `totalSeconds < 60` | Equality `<= 60` | No test at exactly 60000 ms | `formatDuration(60_000) === '1m00s'` |
| 2 | `truncate` non-positive max guard (20, 21) + NoCov (23, 24) | L25 `max <= 0`, L26 `return ""` block | Cond→`false`, `<=`→`<`, Block→`{}`, `""`→Stryker | `truncate` never called with `max <= 0` | `truncate("abc", 0/-2) === ""` |
| 3 | `truncate` exact-length boundary (27) | L28 `value.length <= max` | Equality `< max` | No test where `value.length === max` | `truncate("abcd", 4) === "abcd"` |
| 4 | `pickString` skips empty values (41, 42) | L37 `value.length > 0` | Cond→`true`, `>`→`>=` | No empty-first-key + later-non-empty input | `formatToolArg('task', { description: "", subagent_type: "explore" }) === "explore"` |
| 5 | `firstStringValue` type/length guard (48, 50, 51, 54, 55) | L46 `typeof value === "string" && value.length > 0` | Cond→`true`, `&&`→`||`, LHS→`true`, RHS→`true`, `>`→`>=` | Default-case fallback only tested with a leading non-empty string | empty-first and array-first custom inputs |
| 6 | `isRecord` narrows to objects (60, 62, 63, 65) | L54 `value !== null && typeof value === "object"` | Cond→`true`, `&&`→`||`, LHS→`true`, RHS→`true` | `formatToolArg` never fed a non-record / `null` | `formatToolArg('custom', "hello"/null) === ""` |
| 7 | read/write dispatch + empty-path basename (72) | L62 `case "write"`, L64 `filePath === "" ? ""` | StrLit `case ""` | `write` case untested; empty-`filePath` path untested | `formatToolArg('write', …)`; `('read', { filePath: "" })` documents graceful `""` (L64 literals are residual — see below) |
| 8 | `bash` dispatch uses `command` key (83) | L66 `case "bash"` | StrLit `case ""` | `bash` only tested with `command` as the sole value | `formatToolArg('bash', { a: "x", command: "echo hi" }) === "echo hi"` |
| 9 | `grep`/`glob` dispatch use `pattern` key (86, 88) | L68/L69 `case "grep"`/`case "glob"` | StrLit `case ""` | `pattern` always the sole value in tests | custom-first value + `pattern` |
| 10 | `task` dispatch prioritizes `description` (91, 92) | L71 `case "task"`, L72 return | Cond fallthrough, StrLit `case ""` | `description` never tested alongside an earlier `subagent_type` | `formatToolArg('task', { subagent_type: "explore", description: "find files" }) === "find files"` |
| 11 | `formatLiveLine` empty-arg branch (104, 106) | L79 `arg === ""` | Cond→`false`, `""`→Stryker | No test with tool set AND `arg === ""` | exact `formatLiveLine('fixer','edit','',5000,2)` |
| 12 | `formatLiveLine` singular count + full line (110, 112) | L80 `toolCount === 1 ? "" : "s"` | Cond→`false`, `""`→Stryker | Singular case asserted via `toContain("1 tool")`, which also matches `"1 tools"` | exact full line with `toolCount === 1` |
| 13 | `formatStepFooter` full render + singular (2, 118, 120) | L10 `CHECK`, L90 singular | StrLit `CHECK`→`""`, Cond→`false`, `""`→Stryker | Footer asserted via `toContain`, never as an exact string | exact footer with `toolCount === 1` |
| 14 | `formatTokenCount` million boundary (130) | L96 `n < 1_000_000` | Equality `<= 1_000_000` | No test at exactly 1 000 000 | `formatTokenCount(1_000_000) === "1.00M"` |
| 15 | `activitySummary` verb dictionary (138, 140, 141) | L102/L104/L105 ACTIVITY_VERB values | StrLit `""` | `activitySummary` entirely untested | `activitySummary(['matcher'/'inspector'/'build'])` |
| 16 | `activitySummary` parts/singular/join (149, 152, 155) | L115 `[]`, L117 `n === 1`, L119 `"+"` | Array→`[Stryker]`, Cond→`false`, StrLit `""` | `activitySummary` entirely untested | empty / single / multi / count assertions |

**Equivalent (not in a kill class):** `id 78` and `id 80` — both on L64 of the
read/edit/write branch. See Accepted residuals.

## Design — tests to add

Each new test maps one-to-one onto a gap-analysis row. Every assertion is `toBe(...)`
with a fully-knowable string (no `startsWith`/`endsWith`/`toContain` for new assertions).
Glyphs are copied verbatim from source via `\u` escapes (`\u25B6` ▶, `\u00B7` ·,
`\u2713` ✓, `\u00D7` ×) so expected strings are byte-exact.

- **T1 — `formatDuration` 60s boundary (class 1):** assert `formatDuration(60_000) === "1m00s"`.
- **T2 — `truncate` non-positive max (class 2):** `truncate("abc", 0) === ""`, `truncate("abc", -2) === ""`.
- **T3 — `truncate` exact length (class 3):** `truncate("abcd", 4) === "abcd"`, `truncate("abc", 3) === "abc"`.
- **T4 — `pickString` empty skip (class 4):** `formatToolArg('task', { description: "", subagent_type: "explore" }) === "explore"`.
- **T5 — `firstStringValue` guard (class 5):** `formatToolArg('custom', { a: "", b: "world" }) === "world"` AND `formatToolArg('custom', { a: [1], b: "world" }) === "world"` (empty-first kills 48/50/54/55; array-first kills 51).
- **T6 — `isRecord` guard (class 6):** `formatToolArg('custom', "hello") === ""` (kills 60/62/65) AND `formatToolArg('custom', null) === ""` (kills 63 via throw under mutation).
- **T7 — read/write dispatch (class 7):** `formatToolArg('write', { filePath: "/a/b/x.ts" }) === "x.ts"` (kills 72) AND `formatToolArg('read', { filePath: "" }) === ""` (documents graceful empty-path handling; both L64 literals are equivalent, see residuals).
- **T8 — `bash` key specificity (class 8):** `formatToolArg('bash', { a: "firstval", command: "echo hi" }) === "echo hi"`.
- **T9 — `grep`/`glob` key specificity (class 9):** `formatToolArg('grep', { a: "firstval", pattern: "TODO" }) === "TODO"` AND `formatToolArg('glob', { a: "firstval", pattern: "**/*.ts" }) === "**/*.ts"`.
- **T10 — `task` description priority (class 10):** `formatToolArg('task', { subagent_type: "explore", description: "find files" }) === "find files"`.
- **T11 — `formatLiveLine` empty-arg (class 11):** exact `formatLiveLine('fixer', 'edit', '', 5000, 2)`.
- **T12 — `formatLiveLine` singular exact (class 12):** exact `formatLiveLine('reviewer', 'read', 'a.ts', 1000, 1)` (also drops the now-redundant loose `toContain("1 tool")` test it supersedes).
- **T13 — `formatStepFooter` exact singular (class 13):** exact `formatStepFooter('reviewer', 18000, 1, { input: 13373, output: 31 })`.
- **T14 — `formatTokenCount` million boundary (class 14):** `formatTokenCount(1_000_000) === "1.00M"`.
- **T15 — `activitySummary` verbs (class 15):** `['matcher']→"match"`, `['inspector']→"inspect"`, `['build']→"build"`, `['fixer']→"fix"`, `['reviewer']→"review"`.
- **T16 — `activitySummary` structure (class 16):** `[]→""`, single→bare verb, `['reviewer','fixer']→"review+fix"`, `['reviewer','reviewer','fixer']→"review×2+fix"`, unknown base→itself.

## Verification

1. `bun test tests/review-loop/live-format.test.ts` is green on the unmodified source
   (every expected value was cross-checked against the live module before commit).
2. `bun test:mutate:file review-loop/src/live-format.ts` — **measured post-change counts:**
   killed = **154**, survived = **2** (residuals `id 78`, `id 80`), no-coverage = **0**,
   score = **154/156 = 0.9872 ≥ 0.9**.
3. Margin: only 24 additional kills are required to clear 0.9 (141/156); the plan
   delivers 37 (35 survived + 2 no-coverage), so even partial attrition stays well above threshold.

## Accepted residuals

- **`id 78` — `review-loop/src/live-format.ts:64`, `filePath === ""` → `false`.**
  The expression is `return filePath === "" ? "" : path.basename(filePath)`. Mutating the
  condition to `false` forces `path.basename(filePath)` unconditionally. Because
  `path.basename("") === ""`, both branches produce identical output for every reachable
  `filePath`: `""` (the only value `pickString` yields when no path is present) yields `""`
  on both branches, and any non-empty path yields its basename on both branches. There is
  no reachable input that distinguishes original from mutant, so it is a true equivalent.
- **`id 80` — `review-loop/src/live-format.ts:64`, the compared literal `""` → `"Stryker was here"`.**
  This mutates the *comparison operand* of `filePath === ""`, producing
  `filePath === "Stryker was here"`. For the condition's truth value to change, `filePath`
  would have to be either `""` (original true, mutant false) or exactly `"Stryker was
  here"` (original false, mutant true). The latter is unreachable: `filePath` is the
  return of `pickString(obj, ["filePath", "path"])`, which can only yield a caller-provided
  path string or `""` — never the sentinel. And for `filePath === ""` the two ternary
  branches coincide because `path.basename("") === ""`. Hence no reachable input
  distinguishes original from mutant; it is a true equivalent.
