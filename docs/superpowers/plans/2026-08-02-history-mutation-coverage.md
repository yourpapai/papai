<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# `src/history.ts` Mutation Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the ratcheted mutation floor of `src/history.ts` from 0.21 to the measured maximum (target 1.0) and fix the Stryker sandbox regression that errors every top-level `src/*` paired mutation run.

**Architecture:** Three small, independent changes: (1) a glob-negation fix in `stryker.config.json` so the sandbox copies `.opencode/plugins` (the dry-run blocker), (2) two role-guard tests added to the existing `tests/history-edit.test.ts`, (3) a new `tests/history.test.ts` covering `clearHistory` and the structured-log contracts via a tracked logger mock bound through cache-busting dynamic imports. Then re-measure with the official paired runner and ratchet `scripts/mutation/baseline.json`.

**Tech Stack:** Bun test (`bun:test`), Stryker + `@hughescr/stryker-bun-runner`, drizzle-orm (in-memory test DB), repo helpers `createTrackedLoggerMock()` / `setupTestDb()`.

**Spec:** `docs/superpowers/specs/2026-08-02-history-mutation-coverage-design.md`

## Global Constraints

- New files MUST start with the BUSL-1.1 header comment (pre-commit hook `license-headers` blocks without it):
  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.
  ```
- Import paths in TS use the `.js` extension (`../src/history.js`).
- Never add lint-disable or type-ignore comments (hook policy blocks them).
- Test runner is Bun (`bun test <file>`); no Jest/Vitest APIs.
- Conventional commit messages matching repo style, e.g. `fix(mutation): ...`, `test(history): ...`, `chore(mutation): ratchet baseline`.
- `scripts/mutation/overrides.json` already contains `"src/history.ts": ["tests/history-edit.test.ts", "tests/history.test.ts"]` in the working tree (uncommitted); it ships with Task 3.
- Mutant inventory reference (companion-only probe, `ignoreStatic: false`): 86 mutants = 59 killed + 21 survived + 6 no-coverage. Survivors: role-guards L64/L106, arithmetic L120, 18 log StringLiteral/ObjectLiteral (L15, L18, L23, L25, L29, L80, L84, L114, L120, L121). No-coverage: `clearHistory` body L33-41.

---

### Task 1: Stryker sandbox copies `.opencode/plugins`

`tests/opencode-tdd-enforcement.test.ts` imports `../.opencode/plugins/tdd-enforcement.ts`. Commit `ae61aa748` added `.opencode` to Stryker `ignorePatterns`, so the sandbox copy lacks the plugin and every dry run whose test set includes that file fails with `Cannot find module`. The "same-package" expansion for root `src/*.ts` is all of `tests/*.test.ts`, so **every** top-level `src/` paired run errors. `.opencode/node_modules` (61M) is the junk the ignore targeted; `.opencode/plugins` (20K) must be copied. Globby negations express exactly that.

**Files:**
- Modify: `stryker.config.json` (the `ignorePatterns` array)

**Interfaces:**
- Consumes: nothing
- Produces: dry runs including `tests/opencode-tdd-enforcement.test.ts` pass inside the Stryker sandbox (validated again end-to-end in Task 5)

- [ ] **Step 1: Apply the ignorePatterns fix**

In `stryker.config.json`, replace:

```json
  "ignorePatterns": ["node_modules", ".stryker-tmp", "reports", ".agents", ".codex", ".opencode", ".worktrees"],
```

with:

```json
  "ignorePatterns": ["node_modules", ".stryker-tmp", "reports", ".agents", ".codex", ".opencode", "!.opencode/plugins", "!.opencode/plugins/**", ".worktrees"],
```

- [ ] **Step 2: Write the verification probe config**

Create `.stryker-tmp/stryker.opencode-probe.json` (`.stryker-tmp/` is gitignored; this is a throwaway verification artifact). The two test files are the minimal pair that failed before the fix:

```json
{
  "testRunner": "bun",
  "appendPlugins": ["@hughescr/stryker-bun-runner"],
  "bun": {
    "timeout": 120000,
    "testFiles": ["./tests/ai-output-settings.test.ts", "./tests/opencode-tdd-enforcement.test.ts"]
  },
  "mutate": ["src/history.ts"],
  "coverageAnalysis": "perTest",
  "ignoreStatic": false,
  "incremental": false,
  "concurrency": 8,
  "timeoutMS": 60000,
  "timeoutFactor": 2,
  "thresholds": { "high": 80, "low": 60, "break": 0 },
  "reporters": ["json"],
  "jsonReporter": { "fileName": "reports/paired/opencode-probe.json" },
  "ignorePatterns": ["node_modules", ".stryker-tmp", "reports", ".agents", ".codex", ".opencode", "!.opencode/plugins", "!.opencode/plugins/**", ".worktrees"],
  "cleanTempDir": true
}
```

- [ ] **Step 3: Run the probe — expect the dry run to pass**

Run: `bunx stryker run .stryker-tmp/stryker.opencode-probe.json 2>&1 | grep -E "Initial test run succeeded|failed in the initial"`
Expected: `INFO DryRunExecutor Initial test run succeeded.` (Before the fix the same probe failed with `ConfigError: There were failed tests in the initial test run.` caused by `Cannot find module '../.opencode/plugins/tdd-enforcement.ts'`.) The run continues into mutation testing afterwards; the final score is irrelevant here (these two tests barely cover `src/history.ts`), let it finish or Ctrl-C after the dry-run line.

- [ ] **Step 4: Commit**

```bash
git add stryker.config.json
git commit -m "fix(mutation): copy .opencode/plugins into Stryker sandbox"
```

---

### Task 2: Role-guard mutant tests in `tests/history-edit.test.ts`

Kills the two survived ConditionalExpression mutants that replace `msg.role !== 'user'` with `false` (`src/history.ts:64` in `applyEditToHistory`, `src/history.ts:106` in `trimTurnForRegeneration`). Both tests pass against current code; they exist so the mutants die.

**Files:**
- Test: `tests/history-edit.test.ts` (append one test to each existing `describe`)

**Interfaces:**
- Consumes: `appendHistory`, `applyEditToHistory`, `loadHistory`, `trimTurnForRegeneration` from `../src/history.js` (already imported in the file); `ModelMessage` from `ai` (already imported)
- Produces: no new exports

- [ ] **Step 1: Add the `applyEditToHistory` role-guard test**

Inside the existing `describe('applyEditToHistory', ...)`, after the last test, add:

```ts
  test('skips a non-user turn that carries the edited messageId', () => {
    const assistantWithMeta = {
      role: 'assistant',
      content: 'old answer',
      providerOptions: {
        papai: {
          messageIds: ['m1'],
          segments: [{ messageId: 'm1', text: 'hello', username: null }],
          isThread: false,
          isDm: true,
        },
      },
    } as ModelMessage
    const userMsg = {
      role: 'user',
      content: 'hello',
      providerOptions: {
        papai: {
          messageIds: ['m1'],
          segments: [{ messageId: 'm1', text: 'hello', username: null }],
          isThread: false,
          isDm: true,
        },
      },
    } as ModelMessage
    appendHistory('ctx-role-edit', [assistantWithMeta, userMsg])

    const changed = applyEditToHistory('ctx-role-edit', 'm1', 'hello (edited)')
    expect(changed).toBe(true)

    const history = loadHistory('ctx-role-edit')
    expect(history[0]!.content).toBe('old answer')
    expect(history[1]!.content).toBe('hello (edited)')
  })
```

- [ ] **Step 2: Add the `trimTurnForRegeneration` role-guard test**

Inside the existing `describe('trimTurnForRegeneration', ...)`, after the last test, add:

```ts
  test('trims at the user turn, not a trailing assistant turn with the same messageId', () => {
    const userMsg = {
      role: 'user',
      content: 'hello',
      providerOptions: {
        papai: {
          messageIds: ['m1'],
          segments: [{ messageId: 'm1', text: 'hello', username: null }],
          isThread: false,
          isDm: true,
        },
      },
    } as ModelMessage
    const assistantWithMeta = {
      role: 'assistant',
      content: 'old answer',
      providerOptions: {
        papai: {
          messageIds: ['m1'],
          segments: [{ messageId: 'm1', text: 'hello', username: null }],
          isThread: false,
          isDm: true,
        },
      },
    } as ModelMessage
    appendHistory('ctx-role-trim', [userMsg, assistantWithMeta])

    const trimmed = trimTurnForRegeneration('ctx-role-trim', 'm1')

    expect(trimmed).toBe(true)
    expect(loadHistory('ctx-role-trim')).toEqual([])
  })
```

- [ ] **Step 3: Run the file — expect all tests to pass**

Run: `bun test tests/history-edit.test.ts`
Expected: `11 pass, 0 fail` (9 existing + 2 new)

- [ ] **Step 4: Commit**

```bash
git add tests/history-edit.test.ts
git commit -m "test(history): cover user-role guards in edit/trim turn matching"
```

---

### Task 3: `tests/history.test.ts` — `clearHistory` coverage + log contracts

Covers the 6 no-coverage mutants in `clearHistory` (L33-41) and kills the 19 survived log-metadata mutants (L15 child scope; L18/L23/L25/L29 load/save/append; L80/L84 edit miss/hit; L114/L121 trim miss/hit; L120 `removedCount` arithmetic).

Pattern constraint: `src/history.ts` binds `const log = logger.child({ scope: 'history' })` at module evaluation. Static imports evaluate before the importing file's body, so a static `import` would bind the real logger. The proven repo pattern (`tests/startup-helpers.test.ts`) is: register `mock.module('../src/logger.js', ...)` inside the test body, then force a fresh module evaluation with a cache-busting query string (`?t=${crypto.randomUUID()}`). Each test builds a fresh `createTrackedLoggerMock()` so calls never leak between tests. The cache-busted module re-evaluates `src/history.ts` only; its imports (`cache.js`, drizzle, etc.) stay shared singletons, so `appendHistory`/`loadHistory` still hit the same in-memory store.

`syncHistoryToDb` writes through `queueMicrotask`, so the `clearHistory` test flushes microtasks with one `await Promise.resolve()` before asserting the row exists, and asserts the post-clear row state synchronously (the clear-time upsert microtask must not have run yet).

**Files:**
- Create: `tests/history.test.ts`
- Modify: `scripts/mutation/overrides.json` (already modified in the working tree — stage it with this task)

**Interfaces:**
- Consumes: `createTrackedLoggerMock`, `TrackedLoggerMock`, `LogCall` from `./utils/logger-mock.js`; `setupTestDb` from `./utils/test-helpers.js`; `conversationHistory` from `../src/db/schema.js`; `eq` from `drizzle-orm`; `ModelMessage` from `ai`
- Produces: no exports (test file)

- [ ] **Step 1: Create the test file**

Create `tests/history.test.ts` with exactly this content:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'
import { eq } from 'drizzle-orm'

import { conversationHistory } from '../src/db/schema.js'
import { createTrackedLoggerMock, type LogCall, type TrackedLoggerMock } from './utils/logger-mock.js'
import { setupTestDb } from './utils/test-helpers.js'

type HistoryModule = typeof import('../src/history.js')

// src/history.ts binds `logger.child({ scope: 'history' })` at module-eval time.
// A static import would capture the real logger before the per-test mock is
// registered, so install the mock and force a fresh evaluation with a
// cache-busting query (mirrors tests/startup-helpers.test.ts).
async function loadHistoryModule(tracked: TrackedLoggerMock): Promise<HistoryModule> {
  void mock.module('../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  return import(`../src/history.js?t=${crypto.randomUUID()}`)
}

function findCall(tracked: TrackedLoggerMock, level: LogCall['level'], message: string): LogCall | undefined {
  return tracked.getCallsByLevel(level).find((call) => call.args[1] === message)
}

const makeUserMsg = (messageId: string, text: string): ModelMessage =>
  ({
    role: 'user',
    content: text,
    providerOptions: {
      papai: {
        messageIds: [messageId],
        segments: [{ messageId, text, username: null }],
        isThread: false,
        isDm: true,
      },
    },
  }) as ModelMessage

describe('history log contracts and clearHistory', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('clearHistory clears the cache, deletes the DB row, and logs both lines', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)
    history.appendHistory('ctx-clear', [makeUserMsg('m1', 'hello')])
    await Promise.resolve()

    const before = db.select().from(conversationHistory).where(eq(conversationHistory.userId, 'ctx-clear')).get()
    expect(before).toBeDefined()

    history.clearHistory('ctx-clear')

    expect(history.loadHistory('ctx-clear')).toEqual([])
    const after = db.select().from(conversationHistory).where(eq(conversationHistory.userId, 'ctx-clear')).get()
    expect(after).toBeUndefined()

    const debugCall = findCall(tracked, 'debug', 'clearHistory called')
    expect(debugCall?.args[0]).toEqual({ userId: 'ctx-clear' })
    const infoCall = findCall(tracked, 'info', 'History cleared')
    expect(infoCall?.args[0]).toEqual({ userId: 'ctx-clear' })
  })

  test('loadHistory logs the lookup with userId', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    history.loadHistory('ctx-load')

    const call = findCall(tracked, 'debug', 'loadHistory called')
    expect(call?.args[0]).toEqual({ userId: 'ctx-load' })
  })

  test('saveHistory logs debug and info with the message count', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    history.saveHistory('ctx-save', [makeUserMsg('m1', 'hello')])

    const debugCall = findCall(tracked, 'debug', 'saveHistory called')
    expect(debugCall?.args[0]).toEqual({ userId: 'ctx-save', messageCount: 1 })
    const infoCall = findCall(tracked, 'info', 'History saved to cache (DB sync in background)')
    expect(infoCall?.args[0]).toEqual({ userId: 'ctx-save', messageCount: 1 })
  })

  test('appendHistory logs the append count', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    history.appendHistory('ctx-append', [makeUserMsg('m1', 'hello')])

    const call = findCall(tracked, 'debug', 'appendHistory called')
    expect(call?.args[0]).toEqual({ userId: 'ctx-append', appendCount: 1 })
  })

  test('binds the history child logger with its scope', async () => {
    const tracked = createTrackedLoggerMock()
    await loadHistoryModule(tracked)

    expect(tracked.logger.child).toHaveBeenCalledWith({ scope: 'history' })
  })

  test('applyEditToHistory logs the rewrite on a hit', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)
    history.appendHistory('ctx-edit-hit', [makeUserMsg('m1', 'hello')])

    expect(history.applyEditToHistory('ctx-edit-hit', 'm1', 'hello (edited)')).toBe(true)

    const call = findCall(tracked, 'info', 'applyEditToHistory: user turn rewritten')
    expect(call?.args[0]).toEqual({ contextId: 'ctx-edit-hit', messageId: 'm1' })
  })

  test('applyEditToHistory logs the miss when no turn carries the messageId', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    expect(history.applyEditToHistory('ctx-edit-miss', 'missing', 'x')).toBe(false)

    const call = findCall(tracked, 'debug', 'applyEditToHistory: messageId not found in any user turn')
    expect(call?.args[0]).toEqual({ contextId: 'ctx-edit-miss', messageId: 'missing' })
  })

  test('trimTurnForRegeneration logs the removed count on a hit', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)
    history.appendHistory('ctx-trim-hit', [
      makeUserMsg('m1', 'hello'),
      { role: 'assistant', content: 'old answer' } as ModelMessage,
      { role: 'tool', content: [] } as ModelMessage,
    ])

    expect(history.trimTurnForRegeneration('ctx-trim-hit', 'm1')).toBe(true)

    const call = findCall(tracked, 'info', 'trimTurnForRegeneration: trailing turn removed for regeneration')
    expect(call?.args[0]).toEqual({ contextId: 'ctx-trim-hit', messageId: 'm1', removedCount: 3 })
  })

  test('trimTurnForRegeneration logs the miss when no turn carries the messageId', async () => {
    const tracked = createTrackedLoggerMock()
    const history = await loadHistoryModule(tracked)

    expect(history.trimTurnForRegeneration('ctx-trim-miss', 'missing')).toBe(false)

    const call = findCall(tracked, 'debug', 'trimTurnForRegeneration: originating user message not found')
    expect(call?.args[0]).toEqual({ contextId: 'ctx-trim-miss', messageId: 'missing' })
  })
})
```

- [ ] **Step 2: Run the new file — expect all tests to pass**

Run: `bun test tests/history.test.ts`
Expected: `9 pass, 0 fail`

- [ ] **Step 3: Commit (including the pre-staged overrides entry)**

```bash
git add tests/history.test.ts scripts/mutation/overrides.json
git commit -m "test(history): cover clearHistory and structured log contracts"
```

---

### Task 4: Probe verification — 86/86 mutants

Confirms Tasks 2+3 killed every mutant before touching the baseline. Uses the same paired-runner machinery (`ignoreStatic: false`, perTest coverage) with only the two history test files so a failure is fast to diagnose.

**Files:**
- Create: `.stryker-tmp/stryker.history-probe.json` (gitignored throwaway)

**Interfaces:**
- Consumes: outputs of Tasks 1-3
- Produces: `reports/paired/history-probe.json` with 0 surviving + 0 no-coverage mutants

- [ ] **Step 1: Write the probe config**

Create `.stryker-tmp/stryker.history-probe.json`:

```json
{
  "testRunner": "bun",
  "appendPlugins": ["@hughescr/stryker-bun-runner"],
  "bun": {
    "timeout": 120000,
    "testFiles": ["./tests/history-edit.test.ts", "./tests/history.test.ts"]
  },
  "mutate": ["src/history.ts"],
  "coverageAnalysis": "perTest",
  "ignoreStatic": false,
  "incremental": false,
  "concurrency": 8,
  "timeoutMS": 60000,
  "timeoutFactor": 2,
  "thresholds": { "high": 80, "low": 60, "break": 0 },
  "reporters": ["json"],
  "jsonReporter": { "fileName": "reports/paired/history-probe.json" },
  "ignorePatterns": ["node_modules", ".stryker-tmp", "reports", ".agents", ".codex", ".opencode", "!.opencode/plugins", "!.opencode/plugins/**", ".worktrees"],
  "cleanTempDir": true
}
```

- [ ] **Step 2: Run the probe**

Run: `bunx stryker run .stryker-tmp/stryker.history-probe.json 2>&1 | grep -E "Final mutation score|Initial test run"`
Expected: `Final mutation score of 100.00 ...` (86/86 killed)

- [ ] **Step 3: If anything survives, inspect and kill it**

Only if Step 2 is below 100:

```bash
bun -e '
const r = await Bun.file("reports/paired/history-probe.json").json();
const f = r.files["src/history.ts"];
for (const m of f.mutants.filter((m) => m.status === "Survived" || m.status === "NoCoverage"))
  console.log(`${m.status} ${m.mutatorName} L${m.location.start.line}: ${m.replacement ?? ""}`);
'
```

Add the missing assertion to `tests/history.test.ts` or `tests/history-edit.test.ts` (whichever owns the behavior), re-run that file's tests, then re-run Step 2. If a mutant is genuinely equivalent (no observable behavior difference — none are expected in this file), stop and report it to the user instead of adding Stryker-ignore comments.

- [ ] **Step 4: Commit any follow-up test changes**

```bash
git add tests/history.test.ts tests/history-edit.test.ts
git commit -m "test(history): kill remaining surviving mutants"
```

(Skip the commit if Step 2 was already 100.)

---

### Task 5: Official paired run + baseline ratchet

Measures `src/history.ts` through the official path (`bun test:mutate:file`, which builds its config from the fixed `stryker.config.json` — this is also the end-to-end proof of Task 1) and raises the monotonic floor in `scripts/mutation/baseline.json`. The ratchet uses the repo's own `mergeReports`/`loadBaseline`/`writeBaseline` functions so the score formula `(killed + timeout) / (killed + survived + noCoverage + timeout)` and the sorted-JSON format match the automation exactly.

**Files:**
- Modify: `scripts/mutation/baseline.json` (the `"src/history.ts"` entry, currently `0.21052631578947367`)

**Interfaces:**
- Consumes: `mergeReports` from `scripts/mutation/score-merger.ts`; `loadBaseline`, `writeBaseline` from `scripts/mutation/baseline.ts`; Stryker report at `reports/paired/src__history.ts.json` (written by the paired run)
- Produces: updated `scripts/mutation/baseline.json`

- [ ] **Step 1: Run the official paired measurement**

Run: `bun test:mutate:file src/history.ts 2>&1 | tail -3`
Expected: a final summary line like `Paired mutation summary: files=1 skipped=0 errored=0 killed=86 survived=0 pending=0 score=1` — crucially `errored=0` (previously `errored=1` due to the `.opencode` sandbox bug). Several minutes is normal; the dry run alone runs the 115-file batch per worker.

- [ ] **Step 2: Ratchet the baseline entry**

```bash
bun -e '
import { loadBaseline, writeBaseline } from "./scripts/mutation/baseline.js"
import { mergeReports } from "./scripts/mutation/score-merger.js"
const report = await Bun.file("reports/paired/src__history.ts.json").json()
const merged = mergeReports([report])
const baseline = loadBaseline("scripts/mutation/baseline.json") ?? {}
const current = baseline["src/history.ts"] ?? 0
if (merged.score <= current) throw new Error(`score ${merged.score} did not improve on baseline ${current}`)
baseline["src/history.ts"] = merged.score
writeBaseline("scripts/mutation/baseline.json", baseline)
console.log(`src/history.ts: ${current} -> ${merged.score}`)
'
```

Expected output: `src/history.ts: 0.21052631578947367 -> 1` (or the measured value if below 1).

If the measured score is below 1, do **not** lower expectations silently: go back to Task 4 Step 3 diagnostics (this time against `reports/paired/src__history.ts.json`), kill the survivors, re-run Task 5 Step 1.

- [ ] **Step 3: Regression — root test batch + lint + typecheck**

```bash
bun test tests/*.test.ts
bun run lint
bun run typecheck
```

Expected: root batch all pass (this is the same 115-file set the paired dry run uses), lint clean, typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/mutation/baseline.json
git commit -m "chore(mutation): ratchet baseline"
```

---

## Self-Review Notes

- Spec coverage: sandbox fix (Task 1), role-guard tests (Task 2), clearHistory + log contracts (Task 3), probe verification (Task 4), official measurement + ratchet + regression (Task 5) — every spec section maps to a task.
- `src/history.ts` itself is intentionally unmodified — the work is test-side plus tooling config.
- Follow-up (out of scope, noted in spec): other top-level `src/*` floors (`src/config.ts`, `src/recurring.ts`, `src/memory.ts`, …) can now be re-measured and ratcheted the same way.
