# Review Loop: Config Fix + Progress Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the review-loop config with valid model IDs and add detailed issue-level progress logging during the loop.

**Architecture:** A `ProgressLog` interface is injected via the existing `ReviewLoopDeps` DI pattern. The loop controller emits structured log lines at each stage. The CLI wires `console.log` as the implementation. Config files are updated with correct `opencode acp` commands and model IDs from `opencode models`.

**Tech Stack:** TypeScript, Bun, ACP SDK

---

### Task 1: Create ProgressLog interface

**Files:**

- Create: `scripts/review-loop/progress-log.ts`

- [ ] **Step 1: Create the interface file**

```typescript
export interface ProgressLog {
  log(message: string): void
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/review-loop/progress-log.ts
git commit -m "feat(review-loop): add ProgressLog interface"
```

---

### Task 2: Update config.example.json with valid models

**Files:**

- Modify: `scripts/review-loop/config.example.json`

- [ ] **Step 1: Replace config.example.json contents**

```json
{
  "repoRoot": ".",
  "workDir": ".review-loop",
  "maxRounds": 10,
  "maxNoProgressRounds": 2,
  "reviewer": {
    "command": "opencode",
    "args": ["acp"],
    "env": {},
    "sessionConfig": {
      "model": "ollama-cloud/kimi-k2.6:cloud"
    },
    "invocationPrefix": "/review-code",
    "requireInvocationPrefix": false
  },
  "fixer": {
    "command": "opencode",
    "args": ["acp"],
    "env": {},
    "sessionConfig": {
      "model": "opencode/claude-sonnet-4-6"
    },
    "verifyInvocationPrefix": null,
    "fixInvocationPrefix": null,
    "requireVerifyInvocation": false
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/review-loop/config.example.json
git commit -m "fix(review-loop): correct agent commands and model IDs in example config"
```

---

### Task 3: Create initial .review-loop/config.json

**Files:**

- Create: `.review-loop/config.json`

- [ ] **Step 1: Create the working config**

Copy the corrected config from `config.example.json` to `.review-loop/config.json`. The `.review-loop/` directory is already gitignored.

```bash
mkdir -p .review-loop
cp scripts/review-loop/config.example.json .review-loop/config.json
```

No commit needed — file is gitignored.

---

### Task 4: Add ProgressLog to ReviewLoopDeps and wire logging in loop-controller

**Files:**

- Modify: `scripts/review-loop/loop-controller.ts`

This task adds the `log` field to `ReviewLoopDeps` and inserts logging calls at every meaningful stage in the loop.

- [ ] **Step 1: Add import and update ReviewLoopDeps interface**

In `scripts/review-loop/loop-controller.ts`, add the import at the top (after the existing imports):

```typescript
import type { ProgressLog } from './progress-log.js'
```

Add `log` to `ReviewLoopDeps`:

```typescript
export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  reviewer: PromptingSession
  fixer: PromptingSession
  log: ProgressLog
}
```

- [ ] **Step 2: Add a truncate helper after the TERMINAL_STATUSES constant**

```typescript
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}\u2026`
}
```

- [ ] **Step 3: Add logging to processIssueVerifyFix**

In `processIssueVerifyFix`, after the `recordVerification` call (line 67), add:

```typescript
deps.log.log(
  `[verify] "${truncate(record.issue.title, 60)}" \u2192 ${verifyDecision.verdict}${verifyDecision.verdict === 'valid' ? `, ${verifyDecision.fixability}` : ''}`,
)
```

After the `recordFixAttempt` call (line 89), add:

```typescript
deps.log.log(`[fix] "${truncate(record.issue.title, 60)}" \u2192 fix applied (attempt ${record.fixAttempts})`)
```

- [ ] **Step 4: Add logging to runRound**

At the start of `runRound`, after `deps.runState.currentRound = round` (line 123), add:

```typescript
deps.log.log(`[round ${round}/${deps.config.maxRounds}] Reviewing against plan...`)
```

After `applyReviewRound` (line 129), add a severity summary:

```typescript
if (records.length > 0) {
  const bySeverity: Record<string, number> = {}
  for (const record of records) {
    bySeverity[record.issue.severity] = (bySeverity[record.issue.severity] ?? 0) + 1
  }
  const parts = Object.entries(bySeverity)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(', ')
  deps.log.log(`[round ${round}] Found ${records.length} issues (${parts})`)
}
```

After the `processReviewRecords` call (line 137), add:

```typescript
deps.log.log(`[round ${round}] Fixed ${fixedThisRound}/${records.length} issues this round`)
```

After the `rereviewRound` call (line 138), add:

```typescript
deps.log.log(`[round ${round}] Re-review: ${rereviewResponse.issues.length} issues remaining`)
```

After the stall counter update (line 147), if `fixedThisRound === 0`, add:

```typescript
if (fixedThisRound === 0) {
  deps.log.log(
    `[round ${round}] No issues fixed this round (stall count: ${newNoProgressRounds}/${deps.config.maxNoProgressRounds})`,
  )
}
```

- [ ] **Step 5: Add logging to runReviewLoop for loop-end and max-rounds-exceeded**

In `runReviewLoop`, replace the early-return block (lines 163-170) with:

```typescript
if (nextRound > deps.config.maxRounds) {
  deps.log.log(`[done] max_rounds at round ${deps.runState.currentRound} \u2014 skipping`)
  return Promise.resolve({
    doneReason: 'max_rounds',
    rounds: deps.runState.currentRound,
    ledger: deps.ledger.snapshot,
  })
}
```

- [ ] **Step 6: Add logging after loop completion in runRound**

In `runRound`, before each `return` that signals completion, add a `[done]` log. Replace the clean-return at line 133-135 with:

```typescript
if (records.length === 0) {
  deps.log.log(`[done] clean after ${round} round${round === 1 ? '' : 's'}`)
  await saveRunState(deps.runState)
  return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
}
```

Replace the clean-return after re-review at lines 140-144 with:

```typescript
if (rereviewResponse.issues.length === 0) {
  deps.log.log(`[done] clean after ${round} round${round === 1 ? '' : 's'}`)
  await saveIssueLedger(deps.ledger)
  await saveRunState(deps.runState)
  return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
}
```

Before the `no_progress` return (line 152), add:

```typescript
deps.log.log(`[done] no_progress after ${round} rounds`)
```

Before the `max_rounds` return (line 156), add:

```typescript
deps.log.log(`[done] max_rounds after ${round} rounds`)
```

- [ ] **Step 7: Run existing tests to verify nothing broke**

Run: `bun test tests/review-loop/loop-controller.test.ts`

All 5 existing tests will fail because `ReviewLoopDeps` now requires a `log` field. That is expected — the next task fixes them.

Expected: 5 test failures with "Property 'log' is missing in type"

---

### Task 5: Update existing loop-controller tests with log mock

**Files:**

- Modify: `tests/review-loop/loop-controller.test.ts`

- [ ] **Step 1: Add a helper at the top of the test file (after the imports)**

```typescript
const createSilentLog = () => {
  const messages: string[] = []
  return {
    log: (message: string) => {
      messages.push(message)
    },
    messages,
  }
}
```

- [ ] **Step 2: Add `log` to every `runReviewLoop` call in the test file**

Each test creates a deps object passed to `runReviewLoop`. Add `log: createSilentLog().log` to each one. There are 5 test cases that call `runReviewLoop`:

1. "runs until the reviewer reports no issues" — add after `fixer:` block (around line 111)
2. "uses configured invocation prefixes" — add after `fixer:` block (around line 202)
3. "stops with no_progress" — add after `fixer:` block (around line 287)
4. "does not re-verify issues already in a terminal status" — add after `fixer:` block (around line 371)
5. "plans before fixing" — add after `fixer:` block (around line 475)
6. "stops with max_rounds" — add after `fixer:` block (around line 559)

Each addition follows the same pattern — add this as the last field in the deps object:

```typescript
log: createSilentLog().log,
```

- [ ] **Step 3: Run tests to verify all pass**

Run: `bun test tests/review-loop/loop-controller.test.ts`

Expected: All 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/review-loop/loop-controller.test.ts scripts/review-loop/loop-controller.ts scripts/review-loop/progress-log.ts
git commit -m "feat(review-loop): add detailed progress logging to loop controller"
```

---

### Task 6: Wire console.log-backed ProgressLog in CLI

**Files:**

- Modify: `scripts/review-loop/cli.ts`

- [ ] **Step 1: Add import**

After the existing imports in `cli.ts`:

```typescript
import type { ProgressLog } from './progress-log.js'
```

- [ ] **Step 2: Create the console logger and pass it to runReviewLoop**

In `runCli`, before the `runReviewLoop` call (around line 181), add:

```typescript
const log: ProgressLog = { log: console.log }
```

Then add `log` to the `runReviewLoop` deps object:

```typescript
const result = await runReviewLoop({
  config,
  runState,
  ledger,
  reviewer: reviewerSession,
  fixer: fixerSession,
  log,
})
```

- [ ] **Step 3: Run the CLI test to verify nothing broke**

Run: `bun test tests/review-loop/cli.test.ts`

Expected: All existing tests pass. If the CLI test constructs its own `runReviewLoop` deps, the `log` field must also be added there.

- [ ] **Step 4: Commit**

```bash
git add scripts/review-loop/cli.ts
git commit -m "feat(review-loop): wire console.log progress logging in CLI"
```

---

### Task 7: Add progress logging tests

**Files:**

- Create: `tests/review-loop/progress-log.test.ts`

- [ ] **Step 1: Write tests for progress output**

Create a test file that verifies the log messages emitted during a complete loop cycle.

```typescript
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ReviewLoopConfig } from '../../scripts/review-loop/config.js'
import { createIssueLedger } from '../../scripts/review-loop/issue-ledger.js'
import { runReviewLoop } from '../../scripts/review-loop/loop-controller.js'
import { createRunState } from '../../scripts/review-loop/run-state.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-progress-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeConfig(repoRoot: string): ReviewLoopConfig {
  return {
    repoRoot,
    workDir: path.join(repoRoot, '.review-loop'),
    maxRounds: 5,
    maxNoProgressRounds: 2,
    reviewer: {
      command: 'opencode',
      args: ['acp'],
      env: {},
      sessionConfig: {},
      invocationPrefix: null,
      requireInvocationPrefix: false,
    },
    fixer: {
      command: 'opencode',
      args: ['acp'],
      env: {},
      sessionConfig: {},
      verifyInvocationPrefix: null,
      fixInvocationPrefix: null,
      requireVerifyInvocation: false,
    },
  }
}

describe('progress logging', () => {
  test('logs round start, issue discovery, verification, fix, re-review, and done for a clean round', async () => {
    const repoRoot = makeTempDir()
    const config = makeConfig(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const messages: string[] = []
    let reviewerCallCount = 0
    let fixerCallCount = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      log: {
        log: (message) => {
          messages.push(message)
        },
      },
      reviewer: {
        availableCommands: [],
        promptText: () => {
          reviewerCallCount += 1
          return Promise.resolve({
            text:
              reviewerCallCount === 1
                ? JSON.stringify({
                    round: 1,
                    issues: [
                      {
                        title: 'Missing error handling',
                        severity: 'high',
                        summary: 'Errors are swallowed.',
                        whyItMatters: 'Silent failures.',
                        evidence: 'src/foo.ts line 10',
                        file: 'src/foo.ts',
                        lineStart: 10,
                        lineEnd: 20,
                        suggestedFix: 'Add try/catch.',
                        confidence: 0.9,
                      },
                    ],
                  })
                : JSON.stringify({ round: 2, issues: [] }),
            stopReason: 'end_turn',
          })
        },
      },
      fixer: {
        availableCommands: [],
        promptText: () => {
          fixerCallCount += 1
          return Promise.resolve({
            text:
              fixerCallCount === 1
                ? JSON.stringify({
                    verdict: 'valid',
                    fixability: 'auto',
                    reasoning: 'Confirmed.',
                    targetFiles: ['src/foo.ts'],
                    needsPlanning: false,
                  })
                : 'Fixed.',
            stopReason: 'end_turn',
          })
        },
      },
    })

    expect(result.doneReason).toBe('clean')
    expect(messages).toContain('[round 1/5] Reviewing against plan...')
    expect(messages).toContain('[round 1] Found 1 issues (1 high)')
    expect(messages.some((m) => m.startsWith('[verify] "Missing error handling"'))).toBe(true)
    expect(messages.some((m) => m.startsWith('[fix] "Missing error handling"'))).toBe(true)
    expect(messages).toContain('[round 1] Fixed 1/1 issues this round')
    expect(messages).toContain('[round 1] Re-review: 0 issues remaining')
    expect(messages).toContain('[done] clean after 1 round')
  })

  test('logs stall warning when no issues are fixed', async () => {
    const repoRoot = makeTempDir()
    const config: ReviewLoopConfig = {
      ...makeConfig(repoRoot),
      maxNoProgressRounds: 2,
    }
    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const messages: string[] = []
    let reviewerCallCount = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      log: {
        log: (message) => {
          messages.push(message)
        },
      },
      reviewer: {
        availableCommands: [],
        promptText: () => {
          reviewerCallCount += 1
          return Promise.resolve({
            text: JSON.stringify({
              round: reviewerCallCount,
              issues: [
                {
                  title: 'Persistent issue',
                  severity: 'medium',
                  summary: 'Wontfix.',
                  whyItMatters: 'Low priority.',
                  evidence: 'src/bar.ts line 5',
                  file: 'src/bar.ts',
                  lineStart: 5,
                  lineEnd: 10,
                  suggestedFix: 'Ignore.',
                  confidence: 0.5,
                },
              ],
            }),
            stopReason: 'end_turn',
          })
        },
      },
      fixer: {
        availableCommands: [],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
              verdict: 'needs_human',
              fixability: 'manual',
              reasoning: 'Product decision needed.',
              targetFiles: ['src/bar.ts'],
              needsPlanning: false,
            }),
            stopReason: 'end_turn',
          }),
      },
    })

    expect(result.doneReason).toBe('no_progress')
    expect(messages.some((m) => m.includes('stall count:'))).toBe(true)
    expect(messages.some((m) => m.includes('[done] no_progress'))).toBe(true)
  })

  test('truncates long issue titles in log output', async () => {
    const repoRoot = makeTempDir()
    const config = makeConfig(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const messages: string[] = []

    const longTitle = 'A'.repeat(80)

    await runReviewLoop({
      config,
      runState,
      ledger,
      log: {
        log: (message) => {
          messages.push(message)
        },
      },
      reviewer: {
        availableCommands: [],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
              round: 1,
              issues: [
                {
                  title: longTitle,
                  severity: 'low',
                  summary: 'Minor.',
                  whyItMatters: 'Polish.',
                  evidence: 'src/baz.ts line 1',
                  file: 'src/baz.ts',
                  lineStart: 1,
                  lineEnd: 2,
                  suggestedFix: 'Rename.',
                  confidence: 0.3,
                },
              ],
            }),
            stopReason: 'end_turn',
          }),
      },
      fixer: {
        availableCommands: [],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
              verdict: 'invalid',
              fixability: 'manual',
              reasoning: 'False positive.',
              targetFiles: ['src/baz.ts'],
              needsPlanning: false,
            }),
            stopReason: 'end_turn',
          }),
      },
    })

    const verifyMessage = messages.find((m) => m.startsWith('[verify]'))
    expect(verifyMessage).toBeDefined()
    expect(verifyMessage!.length).toBeLessThan(longTitle.length + 40)
  })
})
```

- [ ] **Step 2: Run the new tests**

Run: `bun test tests/review-loop/progress-log.test.ts`

Expected: All 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/review-loop/progress-log.test.ts
git commit -m "test(review-loop): add progress logging tests"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run all review-loop tests**

Run: `bun test tests/review-loop/`

Expected: All tests pass.

- [ ] **Step 2: Run lint and typecheck**

Run: `bun lint && bun typecheck`

Expected: No errors.

- [ ] **Step 3: Run format check**

Run: `bun format:check`

Expected: No formatting issues.
