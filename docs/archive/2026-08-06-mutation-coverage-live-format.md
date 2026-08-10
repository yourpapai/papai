<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `review-loop/src/live-format.ts` Plan

> **For agentic workers:** Test-only change. Implement task-by-task; each task maps 1:1 to a gap class in the spec (`docs/superpowers/specs/2026-08-06-mutation-coverage-live-format-design.md`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Raise the paired mutation score of `review-loop/src/live-format.ts` from **0.75** to **≥ 0.9** (measured **0.9872**) by adding exact-equality assertions to the companion test file only.

**Architecture:** No source changes. All edits land in `tests/review-loop/live-format.test.ts`. Each new test targets one surviving-mutant class from the measured paired report.

**Tech Stack:** Bun, TypeScript (strict), `bun:test`.

## Global Constraints

- **Test-only.** Edit nothing under `src/`, `client/`, `plugins/`, `scripts/`, or `review-loop/`. Do not touch `scripts/mutation/baseline.json`.
- **Exact equality only** for new assertions: `expect(...).toBe(...)`. No `startsWith`/`endsWith`/`toContain`/`toMatch` where a full string is knowable.
- **One test per gap class** (16 tests → 16 classes).
- **Glyphs verbatim from source** via `\u` escapes: `\u25B6` (▶ ARROW), `\u00B7` (· MIDDLE_DOT), `\u2713` (✓ CHECK), `\u00D7` (× TIMES).
- Use `.js` extension in the import path; keep the existing `bun:test` import style.
- Never add lint-disable / type-ignore comments.
- Expected strings were cross-checked against the live module before writing (see spec Verification).

## Baseline (measured)

`reports/paired/review-loop__src__live-format.ts.stryker-report.json`: 156 mutants — 117 Killed, 37 Survived, 2 NoCoverage. Score `117/156 = 0.75`.

---

### Task 1 — `formatDuration` 60s boundary (class 1, mutant 10)

- [ ] Add test: `expect(formatDuration(60_000)).toBe('1m00s')` inside `describe('formatDuration')`.
- Kills: `id 10` (`totalSeconds < 60` → `<=`).

### Task 2 — `truncate` non-positive max guard (class 2, mutants 20, 21, NoCov 23, 24)

- [ ] Add `describe('truncate')` (import `truncate`): `truncate('abc', 0) === ''`, `truncate('abc', -2) === ''`.
- Kills: `id 20` (cond→false), `id 21` (`<=`→`<`); converts NoCoverage `id 23` (block→`{}`) and `id 24` (`""`→Stryker) to Killed.

### Task 3 — `truncate` exact-length boundary (class 3, mutant 27)

- [ ] In `describe('truncate')`: `truncate('abcd', 4) === 'abcd'`, `truncate('abc', 3) === 'abc'`.
- Kills: `id 27` (`value.length <= max` → `<`).

### Task 4 — `pickString` empty-value skip (class 4, mutants 41, 42)

- [ ] In `describe('formatToolArg')`: `formatToolArg('task', { description: '', subagent_type: 'explore' }) === 'explore'`.
- Kills: `id 41` (`value.length > 0` → true), `id 42` (`>` → `>=`).

### Task 5 — `firstStringValue` type/length guard (class 5, mutants 48, 50, 51, 54, 55)

- [ ] In `describe('formatToolArg')`: `formatToolArg('custom', { a: '', b: 'world' }) === 'world'` AND `formatToolArg('custom', { a: [1], b: 'world' }) === 'world'`.
- Kills: 48/50/54/55 via empty-first; 51 via array-first.

### Task 6 — `isRecord` narrows to objects (class 6, mutants 60, 62, 63, 65)

- [ ] In `describe('formatToolArg')`: `formatToolArg('custom', 'hello') === ''` AND `formatToolArg('custom', null) === ''`.
- Kills: 60/62/65 via string; 63 via `null` (mutant throws on `Object.values(null)`).

### Task 7 — read/write dispatch + empty-path handling (class 7, mutant 72)

- [ ] In `describe('formatToolArg')`: `formatToolArg('write', { filePath: '/a/b/x.ts' }) === 'x.ts'` AND `formatToolArg('read', { filePath: '' }) === ''`.
- Kills: `id 72` (`case 'write'` → `case ''`). The `read { filePath: "" }` assertion documents graceful empty-path handling; the two L64 literals (`id 78`, `id 80`) are equivalent residuals (see Verification).

### Task 8 — `bash` dispatch key specificity (class 8, mutant 83)

- [ ] In `describe('formatToolArg')`: `formatToolArg('bash', { a: 'firstval', command: 'echo hi' }) === 'echo hi'`.
- Kills: `id 83` (`case 'bash'` → `case ''`).

### Task 9 — `grep`/`glob` dispatch key specificity (class 9, mutants 86, 88)

- [ ] In `describe('formatToolArg')`: grep and glob with a leading non-`pattern` string value, asserting the `pattern`.
- Kills: `id 86`, `id 88` (`case 'grep'`/`case 'glob'` → `case ''`).

### Task 10 — `task` description priority (class 10, mutants 91, 92)

- [ ] In `describe('formatToolArg')`: `formatToolArg('task', { subagent_type: 'explore', description: 'find files' }) === 'find files'`.
- Kills: `id 91` (task-body fallthrough to default), `id 92` (`case 'task'` → `case ''`).

### Task 11 — `formatLiveLine` empty-arg branch (class 11, mutants 104, 106)

- [ ] In `describe('formatLiveLine')`: exact `formatLiveLine('fixer', 'edit', '', 5000, 2)` → `` `  fixer      \u25B6 edit \u00B7 5s \u00B7 2 tools` ``.
- Kills: `id 104` (`arg === ''` → false), `id 106` (`""` → Stryker).

### Task 12 — `formatLiveLine` singular count, exact full line (class 12, mutants 110, 112)

- [ ] In `describe('formatLiveLine')`: exact `formatLiveLine('reviewer', 'read', 'a.ts', 1000, 1)` → `` `  reviewer   \u25B6 read a.ts \u00B7 1s \u00B7 1 tool` ``.
- [ ] Remove the now-redundant loose `toContain('1 tool')` singular test it supersedes.
- Kills: `id 110` (`toolCount === 1` → false), `id 112` (`""` → Stryker).

### Task 13 — `formatStepFooter` exact render + singular (class 13, mutants 2, 118, 120)

- [ ] In `describe('formatStepFooter')`: exact `formatStepFooter('reviewer', 18000, 1, { input: 13373, output: 31 })` → `` `  reviewer \u2713 18s \u00B7 1 tool \u00B7 in 13373 / out 31` ``.
- Kills: `id 2` (`CHECK` → `""`), `id 118` (singular cond → false), `id 120` (`""` → Stryker).

### Task 14 — `formatTokenCount` million boundary (class 14, mutant 130)

- [ ] In `describe('formatTokenCount')`: `formatTokenCount(1_000_000) === '1.00M'`.
- Kills: `id 130` (`n < 1_000_000` → `<=`).

### Task 15 — `activitySummary` verb dictionary (class 15, mutants 138, 140, 141)

- [ ] Add `describe('activitySummary')` (import `activitySummary`): `['matcher']→'match'`, `['inspector']→'inspect'`, `['build']→'build'`, `['fixer']→'fix'`, `['reviewer']→'review'`.
- Kills: `id 138`, `id 140`, `id 141` (ACTIVITY_VERB value → `""`).

### Task 16 — `activitySummary` parts/singular/join (class 16, mutants 149, 152, 155)

- [ ] In `describe('activitySummary')`: `[]→''`, single→bare verb, `['reviewer','fixer']→'review+fix'`, `['reviewer','reviewer','fixer']→'review×2+fix'` (`` `review\u00D72+fix` ``), unknown base→itself.
- Kills: `id 149` (`[]` → `[Stryker]`), `id 152` (`n === 1` → false), `id 155` (`'+'` → `""`).

---

## Verification checklist

- [ ] `bun test tests/review-loop/live-format.test.ts` green.
- [ ] `bun test:mutate:file review-loop/src/live-format.ts` reports killed ≥ 141 (**measured: 154 / survived 2 / score 0.9872**).
- [ ] No files changed outside `tests/` and `docs/superpowers/` (plus the single result JSON).
- [ ] Residuals `id 78` and `id 80` documented (equivalent; both on L64, `path.basename("") === ""` and the `"Stryker was here"` comparison operand is unreachable from `pickString`).
