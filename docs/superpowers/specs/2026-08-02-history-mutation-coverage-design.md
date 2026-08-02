<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `src/history.ts` + Stryker sandbox `.opencode` fix

Date: 2026-08-02
Status: approved

## Goal

Raise the mutation-tested floor of `src/history.ts` (baseline `0.21`, the
weakest core conversation-state file in `scripts/mutation/baseline.json`) to
~1.0, and fix the infrastructure regression that makes the official paired
mutation runner error on every top-level `src/*` file.

## Background and findings

### Why `src/history.ts`

Selected from `scripts/mutation/baseline.json` as the most valuable target:
core conversation state (`applyEditToHistory`, `trimTurnForRegeneration`)
used by the message-edit / W2-regeneration flows, a low score (0.21), and
pure-ish logic over the in-memory history cache that is cheap to test
precisely. Zero-score files are thin Kaneo CRUD wrappers (low value per
effort); `src/recurring.ts` has more survivors in absolute terms but is
DB-plumbing heavy; `src/announcements/humanize.ts` is easy but low
criticality.

### Mutant inventory (probe: companion test only, `ignoreStatic: false`)

86 mutants: **59 killed, 21 survived, 6 no-coverage** (score 68.6%).

- **`clearHistory` (src/history.ts:33-41) — 6 no-coverage mutants.** The whole
  function is untested: cache clear, `clearCachedHistoryFlag`, and the drizzle
  `conversationHistory` delete.
- **Role-guard conditionals — 2 survived.** `src/history.ts:64`
  (`applyEditToHistory`) and `src/history.ts:106` (`trimTurnForRegeneration`):
  replacing `msg.role !== 'user'` with `false` survives because no test has a
  non-user message carrying matching `providerOptions.papai.messageIds`.
- **Log-metadata mutants — 13 survived** (12 StringLiteral/ObjectLiteral +
  1 ArithmeticOperator). `logger.child({ scope: 'history' })` (L15),
  debug/info calls in `loadHistory`/`saveHistory`/`appendHistory` (L18, L23,
  L25, L29), `applyEditToHistory` miss/hit logs (L80, L84),
  `trimTurnForRegeneration` miss/hit logs (L114, L121), and the
  `removedCount: history.length - trimmed.length` arithmetic (L120). Killable
  via `createTrackedLoggerMock()` assertions (tests/utils/logger-mock.ts).

### Root cause: paired runner errors on all top-level `src/*` files

`bun test:mutate:file src/history.ts` fails its dry run deterministically:

```
tests/opencode-tdd-enforcement.test.ts > TddEnforcement > runs check:full without tests during session.idle rechecks
```

Reproduction and bisection (probe Stryker configs, 114 → 2 files) showed the
failure is **not** test pollution: `tests/opencode-tdd-enforcement.test.ts`
imports `../.opencode/plugins/tdd-enforcement.ts`, but commit `ae61aa748`
("ignore local agent-tool dirs in stryker sandbox copy") added `.opencode` to
`ignorePatterns` in `stryker.config.json`, so the Stryker sandbox copy lacks
the plugin and the test dies with `Cannot find module
'../.opencode/plugins/tdd-enforcement.ts'`. Verified directly inside a
sandbox directory.

Because the coverage map's "same-package" expansion for root `src/*.ts` files
is all of `tests/*.test.ts` (115 files, including this one), **every**
top-level `src/` paired run errors and the file is excluded from scoring —
floors for `src/history.ts`, `src/config.ts`, `src/memory.ts`,
`src/recurring.ts`, etc. can never be re-measured or raised. This is why
`src/history.ts` is stuck at 0.21.

`.opencode/` contains `plugins/` (20K, needed by the test) and
`node_modules/` (61M, the junk the ignore actually targeted). Globby
negations keep the latter excluded while copying the former; validated with a
probe run (dry run passes).

## Design (approach A: fix + tests + ratchet)

### 1. Stryker sandbox fix

`stryker.config.json`:

```json
"ignorePatterns": ["node_modules", ".stryker-tmp", ".agents", ".codex", ".opencode", "!.opencode/plugins", "!.opencode/plugins/**", ".worktrees"]
```

### 2. Mutant-killing tests

**`tests/history-edit.test.ts`** — two additions in the existing
static-import style:

- `applyEditToHistory` skips non-user turns: history = [assistant message
  **with** papai meta `messageIds: ['m1']`, user message with the same id] →
  `applyEditToHistory(ctx, 'm1', ...)` → assistant content untouched, user
  turn rewritten. Fails under the L64 mutant (assistant would be rewritten
  and the user left stale). Kills mutant L64.
- `trimTurnForRegeneration` trims only at user turns: history = [user message
  meta `['m1']`, assistant message meta `['m1']`] → trim → history becomes
  `[]`. Under the L106 mutant the scan matches the trailing assistant
  (`originIndex = 1`) and `[user]` survives, so the assertion on `[]` fails.
  Kills mutant L106.

**`tests/history.test.ts`** — new file. Log-contract assertions require the
tracked logger to be bound before `src/history.ts` module evaluation (its
`log` is a module-level `logger.child(...)`), and ES static imports evaluate
before module body code, so the file must use:

- file-scope `createTrackedLoggerMock()` + top-level
  `mock.module('../src/logger.js', ...)`;
- dynamic `await import('../src/history.js')` in `beforeAll` (after mock
  registration; the module is then cached for all tests in the file);
- `clearCalls()` in `beforeEach`; `mockLogger()` is **not** used here.

Tests:

- `clearHistory`: seed cache via `appendHistory`, insert a
  `conversationHistory` row via drizzle (`setupTestDb()`), call
  `clearHistory` → assert `loadHistory` returns empty, the DB row is gone,
  and the `'History cleared'` info log fired with `{ userId }`. Covers the 6
  no-coverage mutants (including the BlockStatement→`{}` at L33).
- Log contracts: for `loadHistory`, `saveHistory`, `appendHistory`,
  `applyEditToHistory` (hit + miss), `trimTurnForRegeneration` (hit + miss),
  assert exact metadata objects and message strings from the tracked logger;
  assert `logger.child` was called with `{ scope: 'history' }`; assert the
  trim-hit info log carries `removedCount: 3` for a 3-message removal (kills
  the L120 `+`/`-` ArithmeticOperator mutant).

### 3. Measurement and ratchet

1. Probe verification: Stryker config with
   `testFiles = ["./tests/history-edit.test.ts", "./tests/history.test.ts"]`,
   `mutate = ["src/history.ts"]`, `ignoreStatic: false` → target 86/86
   (100%). Any survivor is investigated and either killed or shown to be an
   equivalent mutant (equivalent mutants are not expected here).
2. Official measurement: `bun test:mutate:file src/history.ts` (dry run now
   passes thanks to section 1).
3. Ratchet: set `scripts/mutation/baseline.json` → `"src/history.ts"` to the
   officially measured score (monotonic up from 0.21). The
   `scripts/mutation/overrides.json` entry
   `"src/history.ts": ["tests/history-edit.test.ts", "tests/history.test.ts"]`
   is already in the working tree and ships with this change.

### Regression checks

- `bun test tests/history-edit.test.ts tests/history.test.ts tests/opencode-tdd-enforcement.test.ts`
- `bun test tests/*.test.ts` (root batch sanity; the 115-file dry-run set)
- repo lint/typecheck per `package.json` scripts

## Trade-offs and risks

- **Log-text coupling.** Asserting exact log strings/metadata makes tests
  sensitive to log wording changes. Accepted: the repo mandates structured
  logging, the mutation gate counts these mutants, and
  `createTrackedLoggerMock()` exists precisely for this.
- **Probe vs paired score divergence.** The 115-file paired run may attribute
  coverage slightly differently than the two-file probe; the baseline records
  the official paired number regardless of the probe result.
- **Scope.** Only `src/history.ts` is re-baselined. Other top-level `src/*`
  files remain at their current (also stale) floors; re-measuring them is
  follow-up work now unblocked by section 1.

## Alternatives considered

- **B: tests only, hand-edit baseline from probe.** Rejected: the official
  runner keeps erroring, the floor is never CI-enforced, probe and paired
  scores may diverge.
- **C: exclude the tdd-enforcement test from mutation sets.** Rejected: hides
  a real module-resolution bug and requires new exclusion machinery in the
  coverage-map tooling.
