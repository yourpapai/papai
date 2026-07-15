<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-Loop Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ACP subprocess orchestration in `review-loop/` with shell-invoked `opencode run` agents, file-based data exchange, LLM issue matching, worktree isolation, and orchestrator-level build validation.

**Architecture:** Two `opencode run` agent roles (reviewer + fixer) invoked per round via shell calls. Agents write structured JSON to gitignored files. Orchestrator reads/validates files with Zod, drives the loop, manages a git worktree, validates builds, and persists a durable issue ledger for resume.

**Tech Stack:** Bun, TypeScript, Zod v4, `opencode run`, git worktree.

**Spec:** `docs/superpowers/specs/2026-07-15-review-loop-simplification-design.md`

---

## File Structure

### Source files (`review-loop/src/`)

| File                        | Action     | Responsibility                                                                                                                     |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `issue-schema.ts`           | **Modify** | Zod schemas for reviewer issues, verifier decisions, fixer results, issue matches. Drop JSON extraction helpers + `needsPlanning`. |
| `config.ts`                 | **Modify** | Simplified config: agent model configs instead of ACP command/args/env/sessionConfig. Add `checkCommand`, `matcher`.               |
| `run-state.ts`              | **Modify** | Simplified run state: drop session IDs, add worktree + artifact file paths.                                                        |
| `issue-ledger.ts`           | **Modify** | ID-based issue tracking (UUID) instead of SHA-256 fingerprints. LLM-matched reopening via `applyMatchedIssues`.                    |
| `prompt-templates.ts`       | **Modify** | File-based exchange prompts: instruct agents to write JSON to specific file paths.                                                 |
| `loop-controller.ts`        | **Modify** | New per-round flow: review → match → per-issue verify+fix → build-validate → converge.                                             |
| `summary.ts`                | **Modify** | Minor: read `id` instead of `fingerprint` from ledger records.                                                                     |
| `cli.ts`                    | **Modify** | New bootstrap: worktree lifecycle, no ACP clients.                                                                                 |
| `agent-runner.ts`           | **Create** | Wraps `opencode run` shell calls with file-based exchange + Zod validation + retry.                                                |
| `issue-matcher.ts`          | **Create** | Builds LLM matching prompt, calls agent-runner, parses matches.json, updates ledger.                                               |
| `worktree.ts`               | **Create** | Git worktree lifecycle: create, merge-back, cleanup, resume detection.                                                             |
| `build-checker.ts`          | **Create** | Runs `checkCommand` in worktree, captures exit code/stderr, handles retry escalation.                                              |
| `progress-log.ts`           | **Keep**   | Unchanged (8 lines, interface only).                                                                                               |
| `acp-process-client.ts`     | **Delete** | ACP plumbing, replaced by `agent-runner.ts`.                                                                                       |
| `acp-connection-methods.ts` | **Delete** | ACP plumbing.                                                                                                                      |
| `process-lifecycle.ts`      | **Delete** | ACP plumbing.                                                                                                                      |
| `agent-session.ts`          | **Delete** | ACP plumbing.                                                                                                                      |
| `permission-policy.ts`      | **Delete** | Replaced by opencode's non-interactive auto-approve.                                                                               |
| `available-commands.ts`     | **Delete** | No more slash-command invocation prefixes.                                                                                         |
| `issue-fingerprint.ts`      | **Delete** | Replaced by LLM matching in `issue-matcher.ts`.                                                                                    |

### Test files (`tests/review-loop/`)

| File                             | Action                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `test-helpers.ts`                | **Modify** — new config fixture shape.                                                |
| `issue-schema.test.ts`           | **Modify** — drop `needsPlanning` tests, add `FixerResult`/`IssueMatch` schema tests. |
| `issue-ledger.test.ts`           | **Modify** — ID-based, `applyMatchedIssues` instead of `applyReviewRound`.            |
| `prompt-templates.test.ts`       | **Modify** — file-based exchange prompts.                                             |
| `loop-controller.test.ts`        | **Modify** — new per-round flow with mock agent-runner.                               |
| `summary.test.ts`                | **Modify** — `id` instead of `fingerprint`.                                           |
| `cli.test.ts`                    | **Modify** — new bootstrap flow.                                                      |
| `run-state.test.ts`              | **Modify** — new paths, no session IDs.                                               |
| `agent-runner.test.ts`           | **Create** — shell invocation, file reading, Zod validation, retry.                   |
| `issue-matcher.test.ts`          | **Create** — matching prompt, matches.json parsing, ledger update.                    |
| `worktree.test.ts`               | **Create** — create, merge, cleanup, resume.                                          |
| `build-checker.test.ts`          | **Create** — exit code, retry, revert.                                                |
| `fake-agent-integration.test.ts` | **Modify** — fake `opencode` script instead of fake ACP agent.                        |
| `acp-process-client.test.ts`     | **Delete**                                                                            |
| `acp-connection-methods.test.ts` | **Delete**                                                                            |
| `available-commands.test.ts`     | **Delete**                                                                            |
| `permission-policy.test.ts`      | **Delete**                                                                            |
| `issue-fingerprint.test.ts`      | **Delete**                                                                            |
| `fake-agent.ts`                  | **Delete** (replaced by fake `opencode` script in integration test).                  |
| `progress-log.test.ts`           | **Keep** (unchanged).                                                                 |

### Config

| File                              | Action                         |
| --------------------------------- | ------------------------------ |
| `review-loop/config.example.json` | **Modify** — new config shape. |

---

## Task 1: Simplify issue-schema.ts

Drop `needsPlanning` from `VerifierDecisionSchema`. Drop all JSON extraction helpers (~120 lines). Add `FixerResultSchema` and `IssueMatchSchema`/`IssueMatchesSchema`. Drop `round` from `ReviewerIssuesSchema`.

**Files:**

- Modify: `review-loop/src/issue-schema.ts`
- Modify: `tests/review-loop/issue-schema.test.ts`

- [ ] **Step 1: Update test to reflect new schemas**

Replace `tests/review-loop/issue-schema.test.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  FixerResultSchema,
  IssueMatchesSchema,
  ReviewerIssueSchema,
  ReviewerIssuesSchema,
  VerifierDecisionSchema,
} from '../../review-loop/src/issue-schema.js'

const validIssue = {
  title: 'Race condition in queue flush path',
  severity: 'high',
  summary: 'Two concurrent messages can bypass the intended lock.',
  whyItMatters: 'This can produce stale assistant replies.',
  evidence: 'src/message-queue/queue.ts lines 84-107',
  file: 'src/message-queue/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Take the processing lock earlier.',
  confidence: 0.92,
}

describe('issue-schema', () => {
  test('ReviewerIssueSchema accepts all severity levels', () => {
    for (const severity of ['critical', 'high', 'medium', 'low']) {
      expect(() => ReviewerIssueSchema.parse({ ...validIssue, severity })).not.toThrow()
    }
  })

  test('ReviewerIssuesSchema accepts issues array without round', () => {
    expect(() => ReviewerIssuesSchema.parse({ issues: [validIssue] })).not.toThrow()
  })

  test('VerifierDecisionSchema does not include needsPlanning', () => {
    const decision = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'The control flow is unsafe.',
      targetFiles: ['src/message-queue/queue.ts'],
    }
    expect(() => VerifierDecisionSchema.parse(decision)).not.toThrow()
    expect(VerifierDecisionSchema.parse(decision)).not.toHaveProperty('needsPlanning')
  })

  test('FixerResultSchema extends VerifierDecision with fixed and commitSha', () => {
    const result = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'Fixed.',
      targetFiles: ['src/message-queue/queue.ts'],
      fixed: true,
      commitSha: 'abc123',
    }
    expect(() => FixerResultSchema.parse(result)).not.toThrow()
  })

  test('FixerResultSchema accepts result without commitSha', () => {
    const result = {
      verdict: 'invalid',
      fixability: 'manual',
      reasoning: 'False positive.',
      targetFiles: [],
      fixed: false,
    }
    expect(() => FixerResultSchema.parse(result)).not.toThrow()
  })

  test('IssueMatchesSchema accepts array of matches', () => {
    const data = {
      matches: [
        { newIssueIndex: 0, existingId: 'issue-001' },
        { newIssueIndex: 1, existingId: null },
      ],
    }
    expect(() => IssueMatchesSchema.parse(data)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/issue-schema.test.ts`
Expected: FAIL — `FixerResultSchema`, `IssueMatchesSchema` not exported; `ReviewerIssuesSchema` still requires `round`.

- [ ] **Step 3: Replace issue-schema.ts**

Replace `review-loop/src/issue-schema.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const ReviewerIssueSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  summary: z.string().min(1),
  whyItMatters: z.string().min(1),
  evidence: z.string().min(1),
  file: z.string().min(1),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  suggestedFix: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const ReviewerIssuesSchema = z.object({
  issues: z.array(ReviewerIssueSchema),
})

export const VerifierDecisionSchema = z.object({
  verdict: z.enum(['valid', 'invalid', 'already_fixed', 'needs_human']),
  fixability: z.enum(['auto', 'manual']),
  reasoning: z.string().min(1),
  targetFiles: z.array(z.string().min(1)),
})

export const FixerResultSchema = VerifierDecisionSchema.extend({
  fixed: z.boolean(),
  commitSha: z.string().nullable().optional(),
})

export const IssueMatchSchema = z.object({
  newIssueIndex: z.number().int().nonnegative(),
  existingId: z.string().nullable(),
})

export const IssueMatchesSchema = z.object({
  matches: z.array(IssueMatchSchema),
})

export type ReviewerIssue = z.infer<typeof ReviewerIssueSchema>
export type ReviewerIssues = z.infer<typeof ReviewerIssuesSchema>
export type VerifierDecision = z.infer<typeof VerifierDecisionSchema>
export type FixerResult = z.infer<typeof FixerResultSchema>
export type IssueMatch = z.infer<typeof IssueMatchSchema>
export type IssueMatches = z.infer<typeof IssueMatchesSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/issue-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/issue-schema.ts tests/review-loop/issue-schema.test.ts
git commit -m "refactor(review-loop): simplify issue-schema — drop needsPlanning, add FixerResult/IssueMatch schemas"
```

---

## Task 2: Simplify config.ts + update test-helpers.ts

Replace ACP-specific agent config (`command`/`args`/`env`/`sessionConfig`/`invocationPrefix`) with simple model-based config (`model`/`extraArgs`). Add `checkCommand` and `matcher` agent config.

**Files:**

- Modify: `review-loop/src/config.ts`
- Modify: `tests/review-loop/test-helpers.ts`

- [ ] **Step 1: Update test-helpers.ts fixture**

Replace `createReviewLoopConfigFixture` in `tests/review-loop/test-helpers.ts`:

```typescript
export function createReviewLoopConfigFixture(
  repoRoot: string,
  overrides?: Partial<ReviewLoopConfig>,
): ReviewLoopConfig {
  return {
    repoRoot,
    workDir: path.join(repoRoot, '.review-loop'),
    maxRounds: 5,
    maxNoProgressRounds: 2,
    checkCommand: 'bun check:full',
    reviewer: {
      model: 'ollama-cloud/kimi-k2.6:cloud',
      extraArgs: [],
    },
    fixer: {
      model: 'opencode/claude-sonnet-4-6',
      extraArgs: [],
    },
    matcher: {
      model: 'ollama-cloud/kimi-k2.6:cloud',
      extraArgs: [],
    },
    ...overrides,
  }
}
```

Keep `makeTempDir` and `cleanupTempDirs` unchanged.

- [ ] **Step 2: Replace config.ts**

Replace `review-loop/src/config.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

const AgentConfigSchema = z.object({
  model: z.string().min(1),
  extraArgs: z.array(z.string()).default([]),
})

export const ReviewLoopConfigSchema = z.object({
  repoRoot: z.string().min(1),
  workDir: z.string().min(1),
  maxRounds: z.number().int().positive().default(10),
  maxNoProgressRounds: z.number().int().positive().default(2),
  checkCommand: z.string().min(1).default('bun check:full'),
  reviewer: AgentConfigSchema,
  fixer: AgentConfigSchema,
  matcher: AgentConfigSchema,
})

export type ReviewLoopConfig = z.infer<typeof ReviewLoopConfigSchema>

export interface ConfigLoadInput {
  configPath: string
  repoRoot?: string
}

export async function loadReviewLoopConfig(input: ConfigLoadInput): Promise<ReviewLoopConfig> {
  const configPath = path.resolve(input.configPath)
  const configDir = path.dirname(configPath)
  const raw = JSON.parse(await readFile(configPath, 'utf8')) as unknown
  const parsed = ReviewLoopConfigSchema.parse(raw)

  const repoRoot =
    input.repoRoot === undefined ? path.resolve(configDir, parsed.repoRoot) : path.resolve(input.repoRoot)
  const workDir = path.resolve(repoRoot, parsed.workDir)

  await mkdir(workDir, { recursive: true })

  return {
    ...parsed,
    repoRoot,
    workDir,
  }
}
```

- [ ] **Step 3: Run typecheck to verify no compile errors in config**

Run: `bun run review-loop:typecheck`
Expected: PASS (other files referencing old config shape will still error — that's expected, we fix them in later tasks)

Note: If typecheck fails due to other files referencing the old config shape, that's OK at this point. We only care that `config.ts` and `test-helpers.ts` themselves are correct. Run the specific test:

Run: `bun test tests/review-loop/test-helpers.ts` (or skip if no dedicated test)

- [ ] **Step 4: Commit**

```bash
git add review-loop/src/config.ts tests/review-loop/test-helpers.ts
git commit -m "refactor(review-loop): simplify config — model-based agent config, add checkCommand + matcher"
```

---

## Task 3: Simplify run-state.ts

Drop session IDs and session pointer files. Add worktree path and artifact file paths (issues, result, matches, log).

**Files:**

- Modify: `review-loop/src/run-state.ts`
- Modify: `tests/review-loop/run-state.test.ts`

- [ ] **Step 1: Update run-state test**

Replace `tests/review-loop/run-state.test.ts` with tests for the new shape:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createRunState, loadRunState, saveRunState } from '../../review-loop/src/run-state.js'
import { createReviewLoopConfigFixture, cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('run-state', () => {
  test('createRunState creates state.json with correct fields', async () => {
    const repoRoot = makeTempDir('run-state-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')

    const state = await createRunState(config, planPath)

    expect(state.runId).toBeDefined()
    expect(state.currentRound).toBe(0)
    expect(state.noProgressRounds).toBe(0)
    expect(state.worktreePath).toBe(path.join(config.workDir, 'worktree'))
    expect(state.ledgerPath).toBe(path.join(state.runDir, 'ledger.json'))
    expect(state.issuesPath).toBe(path.join(state.runDir, 'issues.json'))
    expect(existsSync(state.statePath)).toBe(true)
  })

  test('saveRunState + loadRunState round-trips persisted fields', async () => {
    const repoRoot = makeTempDir('run-state-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')

    const state = await createRunState(config, planPath)
    state.currentRound = 3
    state.noProgressRounds = 1
    await saveRunState(state)

    const loaded = await loadRunState(config.workDir, state.runId)

    expect(loaded.currentRound).toBe(3)
    expect(loaded.noProgressRounds).toBe(1)
    expect(loaded.repoRoot).toBe(config.repoRoot)
    expect(loaded.planPath).toBe(planPath)
    expect(loaded.runDir).toBe(state.runDir)
    expect(loaded.ledgerPath).toBe(state.ledgerPath)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/run-state.test.ts`
Expected: FAIL — `worktreePath`, `ledgerPath`, `issuesPath` not on RunState.

- [ ] **Step 3: Replace run-state.ts**

Replace `review-loop/src/run-state.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { ReviewLoopConfig } from './config.js'

const PersistedRunStateSchema = z.object({
  runId: z.string(),
  repoRoot: z.string(),
  planPath: z.string(),
  currentRound: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
})

export type PersistedRunState = z.infer<typeof PersistedRunStateSchema>

export interface RunState extends PersistedRunState {
  runDir: string
  worktreePath: string
  ledgerPath: string
  issuesPath: string
  resultPath: string
  matchesPath: string
  logPath: string
  statePath: string
}

function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/gu, '-')
}

export async function createRunState(config: ReviewLoopConfig, planPath: string): Promise<RunState> {
  const runId = makeRunId()
  const runDir = path.join(config.workDir, 'runs', runId)

  await mkdir(runDir, { recursive: true })

  const state: RunState = {
    runId,
    runDir,
    worktreePath: path.join(config.workDir, 'worktree'),
    ledgerPath: path.join(runDir, 'ledger.json'),
    issuesPath: path.join(runDir, 'issues.json'),
    resultPath: path.join(runDir, 'result.json'),
    matchesPath: path.join(runDir, 'matches.json'),
    logPath: path.join(runDir, 'agent-output.log'),
    statePath: path.join(runDir, 'state.json'),
    repoRoot: config.repoRoot,
    planPath,
    currentRound: 0,
    noProgressRounds: 0,
  }

  await saveRunState(state)
  return state
}

export async function loadRunState(workDir: string, runId: string): Promise<RunState> {
  const statePath = path.join(workDir, 'runs', runId, 'state.json')
  const runDir = path.dirname(statePath)
  const persisted = PersistedRunStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))

  return {
    ...persisted,
    runDir,
    worktreePath: path.join(workDir, 'worktree'),
    ledgerPath: path.join(runDir, 'ledger.json'),
    issuesPath: path.join(runDir, 'issues.json'),
    resultPath: path.join(runDir, 'result.json'),
    matchesPath: path.join(runDir, 'matches.json'),
    logPath: path.join(runDir, 'agent-output.log'),
    statePath,
  }
}

export async function saveRunState(state: RunState): Promise<void> {
  const persisted = PersistedRunStateSchema.parse(state)
  await writeFile(state.statePath, JSON.stringify(persisted, null, 2))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/run-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/run-state.ts tests/review-loop/run-state.test.ts
git commit -m "refactor(review-loop): simplify run-state — drop session IDs, add artifact paths"
```

---

## Task 4: Rewrite issue-ledger.ts

Replace fingerprint-based keys with UUID-based IDs. Replace `applyReviewRound` (which computes fingerprints internally) with `applyMatchedIssues` (which takes LLM-provided match results). Keep lifecycle states and `recordVerification`/`recordFixAttempt`. Add `closeUnreportedFixed` for the convergence transition.

**Files:**

- Modify: `review-loop/src/issue-ledger.ts`
- Modify: `tests/review-loop/issue-ledger.test.ts`

- [ ] **Step 1: Update issue-ledger test**

Replace `tests/review-loop/issue-ledger.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  applyMatchedIssues,
  closeUnreportedFixed,
  createIssueLedger,
  loadIssueLedger,
  recordFixAttempt,
  recordVerification,
  saveIssueLedger,
} from '../../review-loop/src/issue-ledger.js'
import type { IssueMatch, ReviewerIssue, VerifierDecision } from '../../review-loop/src/issue-schema.js'

const tempDirs: string[] = []

const issue: ReviewerIssue = {
  title: 'Race condition in queue flush path',
  severity: 'high',
  summary: 'Two concurrent messages can bypass the intended lock.',
  whyItMatters: 'This can produce stale assistant replies.',
  evidence: 'src/message-queue/queue.ts lines 84-107',
  file: 'src/message-queue/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Take the processing lock earlier.',
  confidence: 0.92,
}

const validDecision: VerifierDecision = {
  verdict: 'valid',
  fixability: 'auto',
  reasoning: 'The control flow is actually unsafe.',
  targetFiles: ['src/message-queue/queue.ts'],
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('issue ledger', () => {
  test('creates new records for unmatched issues', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const matches: IssueMatch[] = [{ newIssueIndex: 0, existingId: null }]

    const records = applyMatchedIssues(ledger, 1, [issue], matches)

    expect(records).toHaveLength(1)
    expect(records[0]?.id).toBeDefined()
    expect(records[0]?.status).toBe('discovered')
    expect(records[0]?.firstSeenRound).toBe(1)
  })

  test('reopens existing record when matched', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const records1 = applyMatchedIssues(ledger, 1, [issue], [{ newIssueIndex: 0, existingId: null }])
    const id = records1[0]!.id

    recordVerification(ledger, id, validDecision)
    recordFixAttempt(ledger, id)
    ledger.snapshot.issues[id]!.status = 'closed'

    const issueRephrased: ReviewerIssue = {
      ...issue,
      title: 'Race condition when flushing the message queue',
      summary: 'Concurrent flush calls can interleave.',
    }

    applyMatchedIssues(ledger, 2, [issueRephrased], [{ newIssueIndex: 0, existingId: id }])
    await saveIssueLedger(ledger)
    const loaded = await loadIssueLedger(runDir)

    expect(loaded.snapshot.issues[id]?.status).toBe('reopened')
    expect(loaded.snapshot.issues[id]?.issue.title).toBe('Race condition when flushing the message queue')
    expect(loaded.snapshot.issues[id]?.fixAttempts).toBe(1)
  })

  test('closeUnreportedFixed marks fixed_pending_review as closed when not in current round', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const records = applyMatchedIssues(ledger, 1, [issue], [{ newIssueIndex: 0, existingId: null }])
    const id = records[0]!.id

    recordVerification(ledger, id, validDecision)
    recordFixAttempt(ledger, id)

    closeUnreportedFixed(ledger, [id])

    expect(ledger.snapshot.issues[id]?.status).toBe('fixed_pending_review')

    closeUnreportedFixed(ledger, [])

    expect(ledger.snapshot.issues[id]?.status).toBe('closed')
  })

  test('persists and loads correctly', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    applyMatchedIssues(ledger, 1, [issue], [{ newIssueIndex: 0, existingId: null }])
    await saveIssueLedger(ledger)

    const loaded = await loadIssueLedger(runDir)
    expect(Object.keys(loaded.snapshot.issues)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/issue-ledger.test.ts`
Expected: FAIL — `applyMatchedIssues`, `closeUnreportedFixed` not exported.

- [ ] **Step 3: Replace issue-ledger.ts**

Replace `review-loop/src/issue-ledger.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { ReviewerIssueSchema, VerifierDecisionSchema } from './issue-schema.js'
import type { IssueMatch, ReviewerIssue, VerifierDecision } from './issue-schema.js'

export type LedgerIssueStatus =
  | 'discovered'
  | 'verified'
  | 'rejected'
  | 'already_fixed'
  | 'needs_human'
  | 'fixed_pending_review'
  | 'closed'
  | 'reopened'

export const LedgerIssueRecordSchema = z.object({
  id: z.string(),
  issue: ReviewerIssueSchema,
  status: z.enum([
    'discovered',
    'verified',
    'rejected',
    'already_fixed',
    'needs_human',
    'fixed_pending_review',
    'closed',
    'reopened',
  ]),
  firstSeenRound: z.number().int().nonnegative(),
  latestSeenRound: z.number().int().nonnegative(),
  fixAttempts: z.number().int().nonnegative(),
  verifierDecision: VerifierDecisionSchema.nullable(),
})

export const IssueLedgerSnapshotSchema = z.object({
  issues: z.record(z.string(), LedgerIssueRecordSchema),
})

export interface LedgerIssueRecord {
  id: string
  issue: ReviewerIssue
  status: LedgerIssueStatus
  firstSeenRound: number
  latestSeenRound: number
  fixAttempts: number
  verifierDecision: VerifierDecision | null
}

export interface IssueLedgerSnapshot {
  issues: Record<string, LedgerIssueRecord>
}

export interface IssueLedger {
  path: string
  snapshot: IssueLedgerSnapshot
}

export async function createIssueLedger(runDir: string): Promise<IssueLedger> {
  const ledger: IssueLedger = {
    path: path.join(runDir, 'ledger.json'),
    snapshot: { issues: {} },
  }
  await saveIssueLedger(ledger)
  return ledger
}

export async function loadIssueLedger(runDir: string): Promise<IssueLedger> {
  const ledgerPath = path.join(runDir, 'ledger.json')
  const snapshot = IssueLedgerSnapshotSchema.parse(JSON.parse(await readFile(ledgerPath, 'utf8')))
  return {
    path: ledgerPath,
    snapshot,
  }
}

export function applyMatchedIssues(
  ledger: IssueLedger,
  round: number,
  issues: readonly ReviewerIssue[],
  matches: readonly IssueMatch[],
): readonly LedgerIssueRecord[] {
  const seenIndices = new Set<number>()
  const roundRecords: LedgerIssueRecord[] = []

  for (let index = 0; index < issues.length; index += 1) {
    if (seenIndices.has(index)) {
      continue
    }
    seenIndices.add(index)

    const issue = issues[index]!
    const match = matches.find((m) => m.newIssueIndex === index)
    const existingId = match?.existingId ?? null

    if (existingId !== null) {
      const existing = ledger.snapshot.issues[existingId]
      if (existing !== undefined) {
        const reopened: LedgerIssueRecord = {
          ...existing,
          issue,
          latestSeenRound: round,
          status:
            existing.status === 'closed' || existing.status === 'fixed_pending_review' ? 'reopened' : existing.status,
        }
        ledger.snapshot.issues[existingId] = reopened
        roundRecords.push(reopened)
        continue
      }
    }

    const id = randomUUID()
    const record: LedgerIssueRecord = {
      id,
      issue,
      status: 'discovered',
      firstSeenRound: round,
      latestSeenRound: round,
      fixAttempts: 0,
      verifierDecision: null,
    }
    ledger.snapshot.issues[id] = record
    roundRecords.push(record)
  }

  return roundRecords
}

export function closeUnreportedFixed(ledger: IssueLedger, reportedIds: readonly string[]): void {
  const reported = new Set(reportedIds)
  for (const record of Object.values(ledger.snapshot.issues)) {
    if (record.status === 'fixed_pending_review' && !reported.has(record.id)) {
      record.status = 'closed'
    }
  }
}

export function recordVerification(ledger: IssueLedger, id: string, decision: VerifierDecision): void {
  const record = ledger.snapshot.issues[id]
  if (record === undefined) {
    throw new Error(`Unknown issue id ${id}`)
  }
  record.verifierDecision = decision
  record.status = mapVerifierDecisionToLedgerStatus(decision.verdict)
}

export function recordFixAttempt(ledger: IssueLedger, id: string): void {
  const record = ledger.snapshot.issues[id]
  if (record === undefined) {
    throw new Error(`Unknown issue id ${id}`)
  }
  record.fixAttempts += 1
  record.status = 'fixed_pending_review'
}

export async function saveIssueLedger(ledger: IssueLedger): Promise<void> {
  await writeFile(ledger.path, JSON.stringify(ledger.snapshot, null, 2))
}

function mapVerifierDecisionToLedgerStatus(verdict: VerifierDecision['verdict']): LedgerIssueStatus {
  switch (verdict) {
    case 'valid':
      return 'verified'
    case 'already_fixed':
      return 'already_fixed'
    case 'needs_human':
      return 'needs_human'
    case 'invalid':
      return 'rejected'
    default:
      throw new Error('Unhandled verifier verdict')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/issue-ledger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/issue-ledger.ts tests/review-loop/issue-ledger.test.ts
git commit -m "refactor(review-loop): rewrite ledger — UUID IDs, applyMatchedIssues, closeUnreportedFixed"
```

---

## Task 5: Create agent-runner.ts

Wraps `opencode run` shell calls. Spawns the process, waits for exit, reads the output file, validates with Zod. Retries once if the output file is missing or invalid.

**Files:**

- Create: `review-loop/src/agent-runner.ts`
- Create: `tests/review-loop/agent-runner.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/review-loop/agent-runner.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runAgent } from '../../review-loop/src/agent-runner.js'
import { ReviewerIssuesSchema } from '../../review-loop/src/issue-schema.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

type MockSpawnResult = { exitCode: number; stdout: string; stderr: string }

function createMockSpawn(results: MockSpawnResult[]): {
  calls: Array<{ command: string; args: string[]; cwd: string }>
  spawn: (command: string, args: string[], opts: { cwd: string }) => Promise<MockSpawnResult>
} {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = []
  let index = 0
  return {
    calls,
    spawn: (command, args, opts) => {
      calls.push({ command, args, cwd: opts.cwd })
      const result = results[index] ?? results[results.length - 1]!
      index += 1
      return Promise.resolve(result)
    },
  }
}

describe('agent-runner', () => {
  test('runs opencode and reads validated output file', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const issuesData = { issues: [] }
    const mock = createMockSpawn([{ exitCode: 0, stdout: 'done', stderr: '' }])

    writeFileSync(outputPath, JSON.stringify(issuesData))

    const result = await runAgent({
      spawn: mock.spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'review the code',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
    })

    expect(result).toEqual({ issues: [] })
    expect(mock.calls[0]?.command).toBe('opencode')
    expect(mock.calls[0]?.args).toContain('run')
    expect(mock.calls[0]?.args).toContain('--model')
    expect(mock.calls[0]?.args).toContain('test-model')
    expect(mock.calls[0]?.args).toContain('--dir')
    expect(mock.calls[0]?.args).toContain(dir)
  })

  test('retries once when output file is missing', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const issuesData = { issues: [] }
    const mock = createMockSpawn([
      { exitCode: 0, stdout: 'done', stderr: '' },
      { exitCode: 0, stdout: 'done', stderr: '' },
    ])

    const result = await runAgent({
      spawn: mock.spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'review the code',
      outputPath,
      outputSchema: ReviewerIssuesSchema,
      label: 'reviewer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      onRetry: () => {
        writeFileSync(outputPath, JSON.stringify(issuesData))
      },
    })

    expect(result).toEqual({ issues: [] })
    expect(mock.calls).toHaveLength(2)
  })

  test('retries once when output file has invalid JSON', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'result.json')
    const validData = { verdict: 'valid', fixability: 'auto', reasoning: 'ok', targetFiles: [], fixed: true }
    const mock = createMockSpawn([
      { exitCode: 0, stdout: 'done', stderr: '' },
      { exitCode: 0, stdout: 'done', stderr: '' },
    ])

    writeFileSync(outputPath, '{ not valid json')

    const { FixerResultSchema } = await import('../../review-loop/src/issue-schema.js')
    const result = await runAgent({
      spawn: mock.spawn,
      model: 'test-model',
      cwd: dir,
      prompt: 'fix the issue',
      outputPath,
      outputSchema: FixerResultSchema,
      label: 'fixer',
      logPath: path.join(dir, 'log.txt'),
      extraArgs: [],
      onRetry: () => {
        unlinkSync(outputPath)
        writeFileSync(outputPath, JSON.stringify(validData))
      },
    })

    expect(result.fixed).toBe(true)
    expect(mock.calls).toHaveLength(2)
  })

  test('throws after retry if output still invalid', async () => {
    const dir = makeTempDir('agent-runner-')
    const outputPath = path.join(dir, 'issues.json')
    const mock = createMockSpawn([
      { exitCode: 0, stdout: 'done', stderr: '' },
      { exitCode: 0, stdout: 'done', stderr: '' },
    ])

    await expect(
      runAgent({
        spawn: mock.spawn,
        model: 'test-model',
        cwd: dir,
        prompt: 'review the code',
        outputPath,
        outputSchema: ReviewerIssuesSchema,
        label: 'reviewer',
        logPath: path.join(dir, 'log.txt'),
        extraArgs: [],
      }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/agent-runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create agent-runner.ts**

Create `review-loop/src/agent-runner.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile, readFile } from 'node:fs/promises'

import type { z } from 'zod'

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type SpawnFn = (command: string, args: readonly string[], options: { cwd: string }) => Promise<SpawnResult>

export interface RunAgentOptions<T> {
  spawn: SpawnFn
  model: string
  cwd: string
  prompt: string
  outputPath: string
  outputSchema: z.ZodType<T>
  label: string
  logPath: string
  extraArgs: readonly string[]
  onRetry?: () => void
}

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt === 1) {
      options.onRetry?.()
    }

    const result = await options.spawn(
      'opencode',
      ['run', '--model', options.model, '--dir', options.cwd, ...options.extraArgs, options.prompt],
      { cwd: options.cwd },
    )

    await appendFile(options.logPath, `[${options.label}] stdout: ${result.stdout}\nstderr: ${result.stderr}\n`)

    if (result.exitCode !== 0) {
      lastError = new Error(`${options.label} exited with code ${result.exitCode}: ${result.stderr}`)
      continue
    }

    try {
      const raw = await readFile(options.outputPath, 'utf8')
      return options.outputSchema.parse(JSON.parse(raw))
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError ?? new Error(`${options.label} failed after retry`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/agent-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/agent-runner.ts tests/review-loop/agent-runner.test.ts
git commit -m "feat(review-loop): add agent-runner — wraps opencode run with file-based exchange + retry"
```

---

## Task 6: Create worktree.ts

Manages git worktree lifecycle: create, merge-back, cleanup, resume detection.

**Files:**

- Create: `review-loop/src/worktree.ts`
- Create: `tests/review-loop/worktree.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/review-loop/worktree.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { execGit } from '../../review-loop/src/worktree.js'
import { createWorktree, mergeWorktree, removeWorktree, worktreeExists } from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('worktree', () => {
  test('createWorktree creates a linked worktree on a new branch', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])

    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')
    await createWorktree(repoRoot, wtPath, 'test-run')

    expect(existsSync(wtPath)).toBe(true)
    const branch = await execGit(repoRoot, ['branch', '--list', 'review-loop/test-run'])
    expect(branch.stdout.trim()).toContain('review-loop/test-run')
  })

  test('worktreeExists returns true after create, false after remove', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')

    expect(await worktreeExists(wtPath)).toBe(false)

    await createWorktree(repoRoot, wtPath, 'test-run')
    expect(await worktreeExists(wtPath)).toBe(true)

    await removeWorktree(repoRoot, wtPath, 'test-run')
    expect(await worktreeExists(wtPath)).toBe(false)
  })

  test('mergeWorktree merges the branch back to current HEAD', async () => {
    const repoRoot = makeTempDir('worktree-repo-')
    await execGit(repoRoot, ['init'])
    await execGit(repoRoot, ['config', 'user.email', 'test@test.com'])
    await execGit(repoRoot, ['config', 'user.name', 'Test'])
    await execGit(repoRoot, ['checkout', '-b', 'main'])
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path.join(repoRoot, 'README.md'), 'hello')
    await execGit(repoRoot, ['add', '.'])
    await execGit(repoRoot, ['commit', '-m', 'init'])

    const wtPath = path.join(repoRoot, '.review-loop', 'worktree')
    await createWorktree(repoRoot, wtPath, 'test-run')

    writeFileSync(path.join(wtPath, 'fix.txt'), 'fixed')
    await execGit(wtPath, ['add', '.'])
    await execGit(wtPath, ['commit', '-m', 'fix(review-loop): test fix'])

    await mergeWorktree(repoRoot, 'review-loop/test-run')

    expect(existsSync(path.join(repoRoot, 'fix.txt'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/worktree.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create worktree.ts**

Create `review-loop/src/worktree.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const execFileAsync = promisify(execFile)

export async function execGit(cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', [...args], { cwd, maxBuffer: 10 * 1024 * 1024 })
  return { stdout, stderr }
}

export async function createWorktree(repoRoot: string, worktreePath: string, runId: string): Promise<void> {
  const parentDir = path.dirname(worktreePath)
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true })
  }
  await execGit(repoRoot, ['worktree', 'add', worktreePath, '-b', `review-loop/${runId}`])
}

export async function worktreeExists(worktreePath: string): Promise<boolean> {
  return existsSync(worktreePath)
}

export async function mergeWorktree(repoRoot: string, branchName: string): Promise<void> {
  await execGit(repoRoot, ['merge', branchName, '--no-edit'])
}

export async function removeWorktree(repoRoot: string, worktreePath: string, runId: string): Promise<void> {
  if (existsSync(worktreePath)) {
    await execGit(repoRoot, ['worktree', 'remove', worktreePath, '--force'])
  }
  try {
    await execGit(repoRoot, ['branch', '-D', `review-loop/${runId}`])
  } catch {
    // Branch may not exist if already merged and deleted
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/worktree.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/worktree.ts tests/review-loop/worktree.test.ts
git commit -m "feat(review-loop): add worktree lifecycle — create, merge, cleanup"
```

---

## Task 7: Create build-checker.ts

Runs the configured check command in the worktree, captures exit code and stderr. Provides retry escalation logic for the loop controller.

**Files:**

- Create: `review-loop/src/build-checker.ts`
- Create: `tests/review-loop/build-checker.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/review-loop/build-checker.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { runBuildCheck, type ShellExecFn } from '../../review-loop/src/build-checker.js'

function createMockExec(results: Array<{ exitCode: number; stdout: string; stderr: string }>): ShellExecFn {
  let index = 0
  return () => {
    const result = results[index] ?? results[results.length - 1]!
    index += 1
    return Promise.resolve(result)
  }
}

describe('build-checker', () => {
  test('returns passed=true when exit code is 0', async () => {
    const exec = createMockExec([{ exitCode: 0, stdout: 'all good', stderr: '' }])
    const result = await runBuildCheck({ exec, cwd: '/tmp/test', command: 'bun check:full' })
    expect(result.passed).toBe(true)
  })

  test('returns passed=false with stderr when exit code is non-zero', async () => {
    const exec = createMockExec([{ exitCode: 1, stdout: '', stderr: 'TypeError: x is not a function' }])
    const result = await runBuildCheck({ exec, cwd: '/tmp/test', command: 'bun check:full' })
    expect(result.passed).toBe(false)
    expect(result.stderr).toContain('TypeError')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/build-checker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create build-checker.ts**

Create `review-loop/src/build-checker.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ShellExecFn = () => Promise<{ exitCode: number; stdout: string; stderr: string }>

export interface BuildCheckDeps {
  exec: ShellExecFn
  cwd: string
  command: string
}

export interface BuildCheckResult {
  passed: boolean
  stdout: string
  stderr: string
}

export async function runBuildCheck(deps: BuildCheckDeps): Promise<BuildCheckResult> {
  const result = await deps.exec()
  return {
    passed: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

export function createShellExec(cwd: string, command: string): ShellExecFn {
  return async () => {
    try {
      const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      })
      return { exitCode: 0, stdout, stderr }
    } catch (error) {
      const err = error as { code?: number; stdout?: string; stderr?: string }
      return {
        exitCode: err.code ?? 1,
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/build-checker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/build-checker.ts tests/review-loop/build-checker.test.ts
git commit -m "feat(review-loop): add build-checker — runs check command, captures exit code/stderr"
```

---

## Task 8: Create issue-matcher.ts

Builds the LLM matching prompt, invokes agent-runner to match new issues against existing ledger entries, parses matches, and returns match results for the ledger.

**Files:**

- Create: `review-loop/src/issue-matcher.ts`
- Create: `tests/review-loop/issue-matcher.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/review-loop/issue-matcher.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { matchIssues } from '../../review-loop/src/issue-matcher.js'
import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { IssueMatchesSchema } from '../../review-loop/src/issue-schema.js'
import type { LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const existingIssue: ReviewerIssue = {
  title: 'Race condition in queue flush',
  severity: 'high',
  summary: 'Two concurrent messages bypass the lock.',
  whyItMatters: 'Stale replies.',
  evidence: 'queue.ts:84',
  file: 'src/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Lock earlier.',
  confidence: 0.9,
}

const existingRecord: LedgerIssueRecord = {
  id: 'existing-001',
  issue: existingIssue,
  status: 'fixed_pending_review',
  firstSeenRound: 1,
  latestSeenRound: 1,
  fixAttempts: 1,
  verifierDecision: null,
}

const newIssue: ReviewerIssue = {
  ...existingIssue,
  title: 'Race condition when flushing the queue',
  summary: 'Concurrent flush calls interleave without locking.',
}

function createMockSpawn(outputPath: string, data: unknown): SpawnFn {
  return async () => {
    writeFileSync(outputPath, JSON.stringify(data))
    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

describe('issue-matcher', () => {
  test('returns null matches when ledger is empty', async () => {
    const dir = makeTempDir('matcher-')
    const result = await matchIssues({
      spawn: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      newIssues: [newIssue],
      existingRecords: [],
      outputPath: path.join(dir, 'matches.json'),
      logPath: path.join(dir, 'log.txt'),
      cwd: dir,
      model: 'test-model',
      extraArgs: [],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.existingId).toBeNull()
  })

  test('returns LLM-provided matches when ledger has entries', async () => {
    const dir = makeTempDir('matcher-')
    const outputPath = path.join(dir, 'matches.json')
    const matchData = {
      matches: [{ newIssueIndex: 0, existingId: 'existing-001' }],
    }

    const result = await matchIssues({
      spawn: createMockSpawn(outputPath, matchData),
      newIssues: [newIssue],
      existingRecords: [existingRecord],
      outputPath,
      logPath: path.join(dir, 'log.txt'),
      cwd: dir,
      model: 'test-model',
      extraArgs: [],
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.existingId).toBe('existing-001')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/issue-matcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create issue-matcher.ts**

Create `review-loop/src/issue-matcher.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { runAgent, type SpawnFn } from './agent-runner.js'
import { IssueMatchesSchema } from './issue-schema.js'
import type { IssueMatch, ReviewerIssue } from './issue-schema.js'
import type { LedgerIssueRecord } from './issue-ledger.js'

export interface MatchIssuesDeps {
  spawn: SpawnFn
  newIssues: readonly ReviewerIssue[]
  existingRecords: readonly LedgerIssueRecord[]
  outputPath: string
  logPath: string
  cwd: string
  model: string
  extraArgs: readonly string[]
}

function buildMatcherPrompt(
  newIssues: readonly ReviewerIssue[],
  existingRecords: readonly LedgerIssueRecord[],
  outputPath: string,
): string {
  const newSummary = newIssues
    .map((issue, index) => `[${index}] ${issue.file}: ${issue.title} — ${issue.summary}`)
    .join('\n')

  const existingSummary = existingRecords
    .map((record) => `${record.id}: ${record.issue.file}: ${record.issue.title} — ${record.issue.summary}`)
    .join('\n')

  return [
    'Match newly found issues to existing issues from the ledger by semantic similarity.',
    'Two issues match if they describe the same underlying problem, even if worded differently.',
    'Write the result as JSON to:',
    outputPath,
    'Use this exact schema:',
    '{"matches": [{"newIssueIndex": number, "existingId": string | null}]}',
    'Set existingId to null for genuinely new issues.',
    '',
    'New issues:',
    newSummary,
    '',
    'Existing issues:',
    existingSummary || '(none)',
  ].join('\n')
}

export async function matchIssues(deps: MatchIssuesDeps): Promise<IssueMatch[]> {
  if (deps.existingRecords.length === 0) {
    return deps.newIssues.map((_, index) => ({ newIssueIndex: index, existingId: null }))
  }

  const prompt = buildMatcherPrompt(deps.newIssues, deps.existingRecords, deps.outputPath)

  const result = await runAgent({
    spawn: deps.spawn,
    model: deps.model,
    cwd: deps.cwd,
    prompt,
    outputPath: deps.outputPath,
    outputSchema: IssueMatchesSchema,
    label: 'matcher',
    logPath: deps.logPath,
    extraArgs: deps.extraArgs,
  })

  return result.matches
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/issue-matcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/issue-matcher.ts tests/review-loop/issue-matcher.test.ts
git commit -m "feat(review-loop): add issue-matcher — LLM-based semantic issue matching"
```

---

## Task 9: Rewrite prompt-templates.ts

Adapt all prompts for file-based exchange: instruct agents to write JSON to specific file paths. Drop planning prompt. Drop invocation prefix support.

**Files:**

- Modify: `review-loop/src/prompt-templates.ts`
- Modify: `tests/review-loop/prompt-templates.test.ts`

- [ ] **Step 1: Update prompt-templates test**

Replace `tests/review-loop/prompt-templates.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildFixPrompt, buildReviewPrompt, buildRetryFixPrompt } from '../../review-loop/src/prompt-templates.js'
import type { ReviewerIssue, VerifierDecision } from '../../review-loop/src/issue-schema.js'

const issue: ReviewerIssue = {
  title: 'Race condition in queue flush path',
  severity: 'high',
  summary: 'Two concurrent messages can bypass the intended lock.',
  whyItMatters: 'This can produce stale assistant replies.',
  evidence: 'src/message-queue/queue.ts lines 84-107',
  file: 'src/message-queue/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Take the processing lock earlier.',
  confidence: 0.92,
}

describe('prompt-templates', () => {
  test('buildReviewPrompt includes plan path, output path, and schema', () => {
    const prompt = buildReviewPrompt('/path/to/plan.md', '/path/to/issues.json')
    expect(prompt).toContain('/path/to/plan.md')
    expect(prompt).toContain('/path/to/issues.json')
    expect(prompt).toContain('"issues"')
    expect(prompt).toContain('severity')
  })

  test('buildFixPrompt includes issue JSON, output path, commit instructions', () => {
    const prompt = buildFixPrompt(issue, '/path/to/result.json')
    expect(prompt).toContain('src/message-queue/queue.ts')
    expect(prompt).toContain('/path/to/result.json')
    expect(prompt).toContain('commit')
    expect(prompt).toContain('fix(review-loop)')
  })

  test('buildRetryFixPrompt includes error output', () => {
    const prompt = buildRetryFixPrompt(issue, '/path/to/result.json', 'TypeError: x is not a function')
    expect(prompt).toContain('TypeError: x is not a function')
    expect(prompt).toContain('/path/to/result.json')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/prompt-templates.test.ts`
Expected: FAIL — `buildFixPrompt` signature changed, `buildRetryFixPrompt` not exported.

- [ ] **Step 3: Replace prompt-templates.ts**

Replace `review-loop/src/prompt-templates.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewerIssue } from './issue-schema.js'

export function buildReviewPrompt(planPath: string, outputPath: string): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    `Write your findings as JSON to: ${outputPath}`,
    'Include all severity levels: critical, high, medium, low.',
    'Use this exact schema:',
    '{"issues": [{"title": string, "severity": "critical" | "high" | "medium" | "low", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number}]}',
    'If there are no issues, write: {"issues": []}',
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, outputPath: string): string {
  return [
    'Verify and fix the issue below.',
    'First, verify whether this issue is valid, already fixed, or a false positive.',
    'If valid and auto-fixable, fix it, run `bun check:full`, and commit with message: fix(review-loop): <issue title>.',
    'If not fixable automatically, do not modify any files.',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null}',
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildRetryFixPrompt(issue: ReviewerIssue, outputPath: string, buildError: string): string {
  return [
    'Your previous fix broke the build. Fix the build error and try again.',
    `Write your updated result as JSON to: ${outputPath}`,
    'Use the same schema as before.',
    '',
    'Build error output:',
    buildError,
    '',
    'Original issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/prompt-templates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/prompt-templates.ts tests/review-loop/prompt-templates.test.ts
git commit -m "refactor(review-loop): rewrite prompts for file-based exchange"
```

---

## Task 10: Rewrite loop-controller.ts

New per-round flow: review → match → per-issue verify+fix → build-validate → converge. Uses agent-runner, issue-matcher, build-checker.

**Files:**

- Modify: `review-loop/src/loop-controller.ts`
- Modify: `tests/review-loop/loop-controller.test.ts`

- [ ] **Step 1: Update loop-controller test**

Replace `tests/review-loop/loop-controller.test.ts` with tests using mock agent-runner:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { runReviewLoop } from '../../review-loop/src/loop-controller.js'
import { createIssueLedger } from '../../review-loop/src/issue-ledger.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import type { ReviewLoopConfig } from '../../review-loop/src/config.js'
import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const issue: ReviewerIssue = {
  title: 'Race condition in queue flush path',
  severity: 'high',
  summary: 'Two concurrent messages can bypass the intended lock.',
  whyItMatters: 'This can produce stale assistant replies.',
  evidence: 'src/message-queue/queue.ts lines 84-107',
  file: 'src/message-queue/queue.ts',
  lineStart: 84,
  lineEnd: 107,
  suggestedFix: 'Take the processing lock earlier.',
  confidence: 0.92,
}

function extractOutputPath(prompt: string): string | null {
  const match = prompt.match(/(?:to|JSON to):\s*(\S+)/)
  return match?.[1] ?? null
}

function createMockSpawn(handlers: {
  reviewerIssues?: ReviewerIssue[][] // per-round issue sets
  fixerResults?: Array<{ verdict: string; fixability: string; fixed: boolean }>
}): SpawnFn {
  let reviewerCall = 0
  let fixerCall = 0
  return async (_command: string, args: readonly string[], _opts: { cwd: string }) => {
    const promptText = args[args.length - 1] ?? ''
    const outputPath = extractOutputPath(promptText)

    if (promptText.includes('Review the current implementation')) {
      const issues = handlers.reviewerIssues?.[reviewerCall] ?? []
      reviewerCall += 1
      if (outputPath !== null) {
        writeFileSync(outputPath, JSON.stringify({ issues }))
      }
    } else if (promptText.includes('Verify and fix') || promptText.includes('build error')) {
      const result = handlers.fixerResults?.[fixerCall] ?? { verdict: 'valid', fixability: 'auto', fixed: true }
      fixerCall += 1
      if (outputPath !== null) {
        writeFileSync(
          outputPath,
          JSON.stringify({
            ...result,
            reasoning: 'Fixed.',
            targetFiles: [],
            commitSha: result.fixed ? 'abc123' : null,
          }),
        )
      }
    } else if (promptText.includes('Match newly found')) {
      if (outputPath !== null) {
        writeFileSync(outputPath, JSON.stringify({ matches: [] }))
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

function createMockExec(passed: boolean) {
  return async () => ({
    exitCode: passed ? 0 : 1,
    stdout: '',
    stderr: passed ? '' : 'build error',
  })
}

describe('runReviewLoop', () => {
  test('runs until reviewer reports no issues', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
      }),
      exec: createMockExec(true),
      log: { log: () => {} },
    })

    expect(result.doneReason).toBe('clean')
    expect(result.rounds).toBe(2)
  })

  test('stops with no_progress when fixer cannot fix', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], [issue]],
        fixerResults: [{ verdict: 'needs_human', fixability: 'manual', fixed: false }],
      }),
      exec: createMockExec(true),
      log: { log: () => {} },
    })

    expect(result.doneReason).toBe('no_progress')
  })

  test('retries fix when build check fails', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    let execCallCount = 0
    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [
          { verdict: 'valid', fixability: 'auto', fixed: true },
          { verdict: 'valid', fixability: 'auto', fixed: true },
        ],
      }),
      exec: async () => {
        execCallCount += 1
        return execCallCount === 1
          ? { exitCode: 1, stdout: '', stderr: 'TypeError: broken' }
          : { exitCode: 0, stdout: '', stderr: '' }
      },
      log: { log: () => {} },
    })

    expect(result.doneReason).toBe('clean')
    expect(execCallCount).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/loop-controller.test.ts`
Expected: FAIL — `runReviewLoop` interface changed.

- [ ] **Step 3: Replace loop-controller.ts**

Replace `review-loop/src/loop-controller.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { runAgent, type SpawnFn } from './agent-runner.js'
import { createShellExec, runBuildCheck, type ShellExecFn } from './build-checker.js'
import type { ReviewLoopConfig } from './config.js'
import {
  applyMatchedIssues,
  closeUnreportedFixed,
  recordFixAttempt,
  recordVerification,
  saveIssueLedger,
  type IssueLedger,
  type LedgerIssueRecord,
} from './issue-ledger.js'
import { matchIssues } from './issue-matcher.js'
import { FixerResultSchema, ReviewerIssuesSchema } from './issue-schema.js'
import type { ProgressLog } from './progress-log.js'
import { buildFixPrompt, buildReviewPrompt, buildRetryFixPrompt } from './prompt-templates.js'
import { saveRunState, type RunState } from './run-state.js'
import { execGit } from './worktree.js'

const TERMINAL_STATUSES = new Set<LedgerIssueRecord['status']>(['rejected', 'already_fixed', 'needs_human'])

export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: SpawnFn
  exec: ShellExecFn
  log: ProgressLog
}

export interface ReviewLoopResult {
  doneReason: 'clean' | 'max_rounds' | 'no_progress'
  rounds: number
  ledger: IssueLedger['snapshot']
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength - 1)}\u2026`
}

async function processIssue(record: LedgerIssueRecord, deps: ReviewLoopDeps): Promise<{ fixed: boolean }> {
  deps.log.log(`[fix] "${truncate(record.issue.title, 60)}" — verifying...`)

  const fixPrompt = buildFixPrompt(record.issue, deps.runState.resultPath)
  const result = await runAgent({
    spawn: deps.spawn,
    model: deps.config.fixer.model,
    cwd: deps.runState.worktreePath,
    prompt: fixPrompt,
    outputPath: deps.runState.resultPath,
    outputSchema: FixerResultSchema,
    label: 'fixer',
    logPath: deps.runState.logPath,
    extraArgs: deps.config.fixer.extraArgs,
  })

  recordVerification(deps.ledger, record.id, {
    verdict: result.verdict,
    fixability: result.fixability,
    reasoning: result.reasoning,
    targetFiles: result.targetFiles,
  })

  if (!result.fixed || result.verdict !== 'valid') {
    deps.log.log(`[fix] "${truncate(record.issue.title, 60)}" → ${result.verdict}`)
    return { fixed: false }
  }

  const buildResult = await runBuildCheck({
    exec: deps.exec,
    cwd: deps.runState.worktreePath,
    command: deps.config.checkCommand,
  })

  if (buildResult.passed) {
    recordFixAttempt(deps.ledger, record.id)
    deps.log.log(`[fix] "${truncate(record.issue.title, 60)}" → fixed`)
    return { fixed: true }
  }

  deps.log.log(`[fix] build failed, retrying...`)
  const preFixSha = (await execGit(deps.runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

  await runAgent({
    spawn: deps.spawn,
    model: deps.config.fixer.model,
    cwd: deps.runState.worktreePath,
    prompt: buildRetryFixPrompt(record.issue, deps.runState.resultPath, buildResult.stderr),
    outputPath: deps.runState.resultPath,
    outputSchema: FixerResultSchema,
    label: 'fixer-retry',
    logPath: deps.runState.logPath,
    extraArgs: deps.config.fixer.extraArgs,
  })

  const retryBuild = await runBuildCheck({
    exec: deps.exec,
    cwd: deps.runState.worktreePath,
    command: deps.config.checkCommand,
  })

  if (retryBuild.passed) {
    recordFixAttempt(deps.ledger, record.id)
    deps.log.log(`[fix] "${truncate(record.issue.title, 60)}" → fixed (after retry)`)
    return { fixed: true }
  }

  await execGit(deps.runState.worktreePath, ['reset', '--hard', preFixSha])
  recordVerification(deps.ledger, record.id, {
    verdict: 'needs_human',
    fixability: 'manual',
    reasoning: `Build failed after retry: ${retryBuild.stderr}`,
    targetFiles: result.targetFiles,
  })
  deps.log.log(`[fix] "${truncate(record.issue.title, 60)}" → needs_human (build failed)`)
  return { fixed: false }
}

async function runRound(round: number, deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  deps.runState.currentRound = round
  deps.log.log(`[round ${round}/${deps.config.maxRounds}] Reviewing...`)

  const reviewPrompt = buildReviewPrompt(deps.runState.planPath, deps.runState.issuesPath)
  const reviewResult = await runAgent({
    spawn: deps.spawn,
    model: deps.config.reviewer.model,
    cwd: deps.runState.worktreePath,
    prompt: reviewPrompt,
    outputPath: deps.runState.issuesPath,
    outputSchema: ReviewerIssuesSchema,
    label: 'reviewer',
    logPath: deps.runState.logPath,
    extraArgs: deps.config.reviewer.extraArgs,
  })

  const newIssues = reviewResult.issues

  if (newIssues.length === 0 && round === 1) {
    deps.log.log(`[done] clean — no issues found`)
    await saveRunState(deps.runState)
    return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
  }

  const existingRecords = Object.values(deps.ledger.snapshot.issues).filter((r) => !TERMINAL_STATUSES.has(r.status))

  const matches = await matchIssues({
    spawn: deps.spawn,
    newIssues,
    existingRecords,
    outputPath: deps.runState.matchesPath,
    logPath: deps.runState.logPath,
    cwd: deps.runState.worktreePath,
    model: deps.config.matcher.model,
    extraArgs: deps.config.matcher.extraArgs,
  })

  const roundRecords = applyMatchedIssues(deps.ledger, round, newIssues, matches)

  const reportedIds = roundRecords.map((r) => r.id)
  closeUnreportedFixed(deps.ledger, reportedIds)

  await saveIssueLedger(deps.ledger)

  if (newIssues.length === 0) {
    deps.log.log(`[done] clean after ${round} round${round === 1 ? '' : 's'}`)
    await saveRunState(deps.runState)
    return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
  }

  deps.log.log(`[round ${round}] Found ${newIssues.length} issues`)

  let fixedThisRound = 0
  for (const record of roundRecords) {
    if (TERMINAL_STATUSES.has(record.status)) {
      continue
    }
    const result = await processIssue(record, deps)
    if (result.fixed) {
      fixedThisRound += 1
    }
  }

  deps.log.log(`[round ${round}] Fixed ${fixedThisRound}/${roundRecords.length} issues`)

  const newNoProgress = fixedThisRound === 0 ? deps.runState.noProgressRounds + 1 : 0
  deps.runState.noProgressRounds = newNoProgress
  await saveRunState(deps.runState)
  await saveIssueLedger(deps.ledger)

  if (newNoProgress >= deps.config.maxNoProgressRounds) {
    deps.log.log(`[done] no_progress`)
    return { doneReason: 'no_progress', rounds: round, ledger: deps.ledger.snapshot }
  }

  if (round >= deps.config.maxRounds) {
    deps.log.log(`[done] max_rounds`)
    return { doneReason: 'max_rounds', rounds: round, ledger: deps.ledger.snapshot }
  }

  return runRound(round + 1, deps)
}

export async function runReviewLoop(deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  const nextRound = deps.runState.currentRound + 1
  if (nextRound > deps.config.maxRounds) {
    return { doneReason: 'max_rounds', rounds: deps.runState.currentRound, ledger: deps.ledger.snapshot }
  }
  return runRound(nextRound, deps)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/loop-controller.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/loop-controller.ts tests/review-loop/loop-controller.test.ts
git commit -m "refactor(review-loop): rewrite loop-controller — shell-based per-round flow with build validation"
```

---

## Task 11: Update summary.ts + rewrite cli.ts

Update summary to use `id` instead of `fingerprint`. Rewrite CLI to use worktree lifecycle instead of ACP bootstrap.

**Files:**

- Modify: `review-loop/src/summary.ts`
- Modify: `review-loop/src/cli.ts`
- Modify: `tests/review-loop/summary.test.ts`
- Modify: `tests/review-loop/cli.test.ts`

- [ ] **Step 1: Update summary test**

Replace `tests/review-loop/summary.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatSummary } from '../../review-loop/src/summary.js'
import type { IssueLedgerSnapshot } from '../../review-loop/src/issue-ledger.js'

function makeSnapshot(statuses: string[]): IssueLedgerSnapshot {
  return {
    issues: Object.fromEntries(
      statuses.map((status, index) => [
        `id-${index}`,
        {
          id: `id-${index}`,
          issue: {
            title: `Issue ${index}`,
            severity: 'high',
            summary: 'Summary',
            whyItMatters: 'Matters',
            evidence: 'Evidence',
            file: 'src/x.ts',
            lineStart: 1,
            lineEnd: 2,
            suggestedFix: 'Fix',
            confidence: 0.9,
          },
          status,
          firstSeenRound: 1,
          latestSeenRound: 1,
          fixAttempts: 0,
          verifierDecision: null,
        },
      ]),
    ),
  }
}

describe('formatSummary', () => {
  test('counts issues by terminal status', () => {
    const summary = formatSummary({
      doneReason: 'clean',
      rounds: 3,
      ledger: makeSnapshot(['closed', 'closed', 'rejected', 'needs_human']),
    })
    expect(summary).toContain('Done reason: clean')
    expect(summary).toContain('Rounds executed: 3')
    expect(summary).toContain('Closed issues: 2')
    expect(summary).toContain('Rejected issues: 1')
    expect(summary).toContain('Needs human: 1')
  })
})
```

- [ ] **Step 2: Replace summary.ts**

Replace `review-loop/src/summary.ts` (unchanged logic, still reads `status` field — no changes needed since it doesn't reference `fingerprint`):

The existing `summary.ts` already works with the new ledger shape since it only reads `record.status`. No changes needed. But update the test to match the new ledger record shape (done in Step 1).

- [ ] **Step 3: Update cli test**

Replace `tests/review-loop/cli.test.ts` with a focused test on arg parsing (the full integration is covered by `fake-agent-integration.test.ts`):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseCliArgs } from '../../review-loop/src/cli.js'

describe('parseCliArgs', () => {
  test('parses --config and --plan', () => {
    const args = parseCliArgs(['--config', '/path/to/config.json', '--plan', '/path/to/plan.md'])
    expect(args.configPath).toBe('/path/to/config.json')
    expect(args.planPath).toBe('/path/to/plan.md')
  })

  test('parses --resume-run', () => {
    const args = parseCliArgs([
      '--config',
      '/path/to/config.json',
      '--plan',
      '/path/to/plan.md',
      '--resume-run',
      '2026-07-15T10-30-00-000Z',
    ])
    expect(args.resumeRunId).toBe('2026-07-15T10-30-00-000Z')
  })

  test('throws on missing --plan', () => {
    expect(() => parseCliArgs(['--config', '/path/to/config.json'])).toThrow('Missing required --plan')
  })
})
```

- [ ] **Step 4: Replace cli.ts**

Replace `review-loop/src/cli.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { createShellExec } from './build-checker.js'
import { loadReviewLoopConfig } from './config.js'
import { createIssueLedger, loadIssueLedger, type IssueLedger } from './issue-ledger.js'
import { runReviewLoop } from './loop-controller.js'
import type { ProgressLog } from './progress-log.js'
import { createRunState, loadRunState, type RunState } from './run-state.js'
import { formatSummary } from './summary.js'
import { createWorktree, mergeWorktree, removeWorktree, worktreeExists } from './worktree.js'
import type { SpawnFn } from './agent-runner.js'

const execFileAsync = promisify(execFile)

const execFileAsync = promisify(spawn)

export interface CliArgs {
  configPath: string
  planPath: string
  repoRoot?: string
  resumeRunId?: string
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  let configPath = '.review-loop/config.json'
  let planPath: string | undefined
  let repoRoot: string | undefined
  let resumeRunId: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--config') {
      const value = argv[index + 1]
      if (value === undefined) {
        throw new Error('Missing value for --config')
      }
      configPath = value
      index += 1
      continue
    }
    if (arg === '--plan') {
      planPath = argv[index + 1]
      if (planPath === undefined) {
        throw new Error('Missing value for --plan')
      }
      index += 1
      continue
    }
    if (arg === '--repo') {
      repoRoot = argv[index + 1]
      if (repoRoot === undefined) {
        throw new Error('Missing value for --repo')
      }
      index += 1
      continue
    }
    if (arg === '--resume-run') {
      resumeRunId = argv[index + 1]
      if (resumeRunId === undefined) {
        throw new Error('Missing value for --resume-run')
      }
      index += 1
    }
  }

  if (planPath === undefined) {
    throw new Error('Missing required --plan')
  }

  return { configPath, planPath, repoRoot, resumeRunId }
}

const realSpawn: SpawnFn = async (command, args, options) => {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      ...options,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { exitCode: 0, stdout, stderr }
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string }
    return {
      exitCode: err.code ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    }
  }
}

export async function runCli(argv: readonly string[]): Promise<void> {
  const args = parseCliArgs(argv)
  const config = await loadReviewLoopConfig({
    configPath: args.configPath,
    repoRoot: args.repoRoot,
  })

  const runState: RunState =
    args.resumeRunId === undefined
      ? await createRunState(config, args.planPath)
      : await loadRunState(config.workDir, args.resumeRunId)

  const ledger: IssueLedger =
    args.resumeRunId === undefined ? await createIssueLedger(runState.runDir) : await loadIssueLedger(runState.runDir)

  const wtExists = await worktreeExists(runState.worktreePath)
  if (!wtExists) {
    await createWorktree(config.repoRoot, runState.worktreePath, runState.runId)
  }

  const log: ProgressLog = { log: console.log }
  const exec = createShellExec(runState.worktreePath, config.checkCommand)

  try {
    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: realSpawn,
      exec,
      log,
    })

    const summary = formatSummary(result)
    await writeFile(path.join(runState.runDir, 'summary.txt'), `${summary}\n`)
    console.log(summary)

    await mergeWorktree(config.repoRoot, `review-loop/${runState.runId}`)
    await removeWorktree(config.repoRoot, runState.worktreePath, runState.runId)
  } catch (error) {
    console.error('Review loop failed:', error)
    console.error(`Worktree preserved at ${runState.worktreePath} for inspection.`)
    throw error
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/review-loop/summary.test.ts tests/review-loop/cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add review-loop/src/summary.ts review-loop/src/cli.ts tests/review-loop/summary.test.ts tests/review-loop/cli.test.ts
git commit -m "refactor(review-loop): rewrite cli — worktree lifecycle, shell-based agent calls"
```

---

## Task 12: Delete ACP plumbing + update config.example.json + rewrite integration test

Delete all ACP-specific source files and their tests. Update `config.example.json`. Rewrite the fake-agent integration test to use a fake `opencode` script instead of a fake ACP agent.

**Files:**

- Delete: `review-loop/src/acp-process-client.ts`
- Delete: `review-loop/src/acp-connection-methods.ts`
- Delete: `review-loop/src/process-lifecycle.ts`
- Delete: `review-loop/src/agent-session.ts`
- Delete: `review-loop/src/permission-policy.ts`
- Delete: `review-loop/src/available-commands.ts`
- Delete: `review-loop/src/issue-fingerprint.ts`
- Delete: `tests/review-loop/acp-process-client.test.ts`
- Delete: `tests/review-loop/acp-connection-methods.test.ts`
- Delete: `tests/review-loop/available-commands.test.ts`
- Delete: `tests/review-loop/permission-policy.test.ts`
- Delete: `tests/review-loop/issue-fingerprint.test.ts`
- Delete: `tests/review-loop/fake-agent.ts`
- Modify: `review-loop/config.example.json`
- Modify: `tests/review-loop/fake-agent-integration.test.ts`
- Modify: `review-loop/package.json` (remove `@agentclientprotocol/sdk` dependency)

- [ ] **Step 1: Delete ACP source files**

```bash
rm review-loop/src/acp-process-client.ts \
   review-loop/src/acp-connection-methods.ts \
   review-loop/src/process-lifecycle.ts \
   review-loop/src/agent-session.ts \
   review-loop/src/permission-policy.ts \
   review-loop/src/available-commands.ts \
   review-loop/src/issue-fingerprint.ts
```

- [ ] **Step 2: Delete ACP test files + fake-agent.ts**

```bash
rm tests/review-loop/acp-process-client.test.ts \
   tests/review-loop/acp-connection-methods.test.ts \
   tests/review-loop/available-commands.test.ts \
   tests/review-loop/permission-policy.test.ts \
   tests/review-loop/issue-fingerprint.test.ts \
   tests/review-loop/fake-agent.ts
```

- [ ] **Step 3: Update config.example.json**

Replace `review-loop/config.example.json`:

```json
{
  "repoRoot": ".",
  "workDir": ".review-loop",
  "maxRounds": 10,
  "maxNoProgressRounds": 2,
  "checkCommand": "bun check:full",
  "reviewer": {
    "model": "ollama-cloud/kimi-k2.6:cloud",
    "extraArgs": []
  },
  "fixer": {
    "model": "opencode/claude-sonnet-4-6",
    "extraArgs": []
  },
  "matcher": {
    "model": "ollama-cloud/kimi-k2.6:cloud",
    "extraArgs": []
  }
}
```

- [ ] **Step 4: Update package.json — remove ACP dependency**

In `review-loop/package.json`, remove `@agentclientprotocol/sdk` and `p-limit` (no longer used — the new loop-controller processes issues sequentially with a for-loop):

```json
{
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

- [ ] **Step 5: Rewrite fake-agent-integration.test.ts**

Replace `tests/review-loop/fake-agent-integration.test.ts` with a test that uses a fake `opencode` shell script:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runCli } from '../../review-loop/src/cli.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createFakeOpencode(
  binDir: string,
  scenario: {
    reviewerIssues: string[]
    fixerResults: string[]
  },
): void {
  const scriptPath = path.join(binDir, 'opencode')
  const script = `#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const prompt = args[args.length - 1] ?? ''

function extractOutputPath(text) {
  const match = text.match(/(?:to|JSON to):\\s*(\\S+)/)
  return match?.[1] ?? null
}

const scenarioPath = process.env.FAKE_OPENCODE_SCENARIO
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'))
const outputPath = extractOutputPath(prompt)

if (prompt.includes('Review the current implementation')) {
  const issues = scenario.reviewerIssues[scenario._reviewerCall ?? 0] ?? '{"issues":[]}'
  scenario._reviewerCall = (scenario._reviewerCall ?? 0) + 1
  writeFileSync(scenarioPath, JSON.stringify(scenario))
  if (outputPath) writeFileSync(outputPath, issues)
} else if (prompt.includes('Verify and fix') || prompt.includes('build error')) {
  const result = scenario.fixerResults[scenario._fixerCall ?? 0] ?? '{}'
  scenario._fixerCall = (scenario._fixerCall ?? 0) + 1
  writeFileSync(scenarioPath, JSON.stringify(scenario))
  if (outputPath) writeFileSync(outputPath, result)
} else if (prompt.includes('Match newly found')) {
  if (outputPath) writeFileSync(outputPath, JSON.stringify({ matches: [] }))
}
process.exit(0)
`
  writeFileSync(scriptPath, script)
  chmodSync(scriptPath, 0o755)
}

describe('review-loop fake integration', () => {
  test('writes summary after a clean fake-agent run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-integration-'))
    tempDirs.push(dir)

    const binDir = path.join(dir, 'bin')
    const scenarioPath = path.join(dir, 'scenario.json')
    const configPath = path.join(dir, 'config.json')
    const planPath = path.join(dir, 'plan.md')
    const repoPath = path.join(dir, 'repo')

    writeFileSync(planPath, '# Implementation plan\n')

    const scenario = {
      reviewerIssues: [
        JSON.stringify({
          issues: [
            {
              title: 'Race condition',
              severity: 'high',
              summary: 'Concurrent messages bypass lock.',
              whyItMatters: 'Stale replies.',
              evidence: 'queue.ts:84',
              file: 'src/queue.ts',
              lineStart: 84,
              lineEnd: 107,
              suggestedFix: 'Lock earlier.',
              confidence: 0.9,
            },
          ],
        }),
        JSON.stringify({ issues: [] }),
      ],
      fixerResults: [
        JSON.stringify({
          verdict: 'valid',
          fixability: 'auto',
          reasoning: 'Unsafe.',
          targetFiles: ['src/queue.ts'],
          fixed: true,
          commitSha: 'abc123',
        }),
      ],
    }
    writeFileSync(scenarioPath, JSON.stringify(scenario))

    writeFileSync(
      configPath,
      JSON.stringify({
        repoRoot: repoPath,
        workDir: path.join(dir, '.review-loop'),
        maxRounds: 5,
        maxNoProgressRounds: 2,
        checkCommand: 'true',
        reviewer: { model: 'test-reviewer', extraArgs: [] },
        fixer: { model: 'test-fixer', extraArgs: [] },
        matcher: { model: 'test-matcher', extraArgs: [] },
      }),
    )

    // Init a git repo for the worktree test
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init', repoPath])
    execFileSync('git', ['-C', repoPath, 'config', 'user.email', 'test@test.com'])
    execFileSync('git', ['-C', repoPath, 'config', 'user.name', 'Test'])
    execFileSync('git', ['-C', repoPath, 'checkout', '-b', 'main'])
    writeFileSync(path.join(repoPath, 'README.md'), 'hello')
    execFileSync('git', ['-C', repoPath, 'add', '.'])
    execFileSync('git', ['-C', repoPath, 'commit', '-m', 'init'])

    createFakeOpencode(binDir, scenario)

    const oldPath = process.env['PATH']
    process.env['PATH'] = `${binDir}:${oldPath}`
    process.env['FAKE_OPENCODE_SCENARIO'] = scenarioPath

    try {
      await runCli(['--config', configPath, '--plan', planPath])
    } finally {
      process.env['PATH'] = oldPath
      delete process.env['FAKE_OPENCODE_SCENARIO']
    }

    const runRoot = path.join(dir, '.review-loop', 'runs')
    const { readdirSync } = await import('node:fs')
    const runId = readdirSync(runRoot)[0]
    expect(runId).toBeDefined()
    const summary = readFileSync(path.join(runRoot, runId!, 'summary.txt'), 'utf8')
    expect(summary).toContain('Done reason: clean')
  })
})
```

- [ ] **Step 6: Run typecheck and lint**

Run: `bun run review-loop:typecheck`
Expected: PASS — no references to deleted files remain.

Run: `bun run review-loop:lint`
Expected: PASS

If typecheck fails due to dangling imports of deleted modules, search for and remove them:

```bash
rg "acp-process-client|acp-connection-methods|process-lifecycle|agent-session|permission-policy|available-commands|issue-fingerprint" review-loop/src/ tests/review-loop/
```

Fix any remaining references.

- [ ] **Step 7: Run full review-loop test suite**

Run: `bun run review-loop:test`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add -A review-loop/src/ review-loop/config.example.json review-loop/package.json tests/review-loop/
git commit -m "refactor(review-loop): delete ACP plumbing, update config, rewrite integration test"
```

---

## Post-Implementation Verification

After all tasks are complete:

- [ ] **Full check:** `bun run review-loop:typecheck && bun run review-loop:lint && bun run review-loop:format:check && bun run review-loop:test`
- [ ] **No dangling references:** `rg "acp|fingerprint|sessionConfig|invocationPrefix|needsPlanning|@agentclientprotocol" review-loop/ tests/review-loop/` — should return nothing
- [ ] **File count:** `ls review-loop/src/*.ts | wc -l` — should be 12 files (down from 16)
- [ ] **Line count:** `wc -l review-loop/src/*.ts` — should be significantly less than before
