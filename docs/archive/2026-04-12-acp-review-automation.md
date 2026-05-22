<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ACP Review Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Bun/TypeScript CLI that uses ACP to run the full Claude review -> OpenCode verify/fix -> Claude re-review loop until no critical/high issues remain.

**Architecture:** Keep the feature entirely in `scripts/review-loop/` so it stays separate from papai runtime code. The implementation layers are: config/CLI bootstrap, typed issue contracts + durable run state, ACP subprocess/session wrappers, command-resolution and permission policy helpers, then the loop controller that wires everything together and persists transcripts plus summaries under `.review-loop/`.

**Tech Stack:** Bun, TypeScript, `@agentclientprotocol/sdk`, Zod, Bun test, existing repo scripts (`bun run typecheck`, `bun run check:full`)

---

## Scope Check

This stays as one implementation plan. The ACP client wrapper, session handling,
issue ledger, command resolution, permission policy, and loop controller are one
vertical slice; splitting them into separate plans would force the implementer
to guess shared types, file layout, and run-state behavior.

## File Structure

| Path                                               | Responsibility                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `package.json`                                     | Add `@agentclientprotocol/sdk`, add `review:loop` script, include `tests/review-loop` in the default `test` script |
| `.gitignore`                                       | Ignore `.review-loop/` run artifacts                                                                               |
| `scripts/review-loop.ts`                           | Shebang entry point that calls `runCli()`                                                                          |
| `scripts/review-loop/config.ts`                    | Zod-backed config schema and config loading                                                                        |
| `scripts/review-loop/cli.ts`                       | CLI arg parsing, run bootstrap, smoke-test-ready `runCli()`                                                        |
| `scripts/review-loop/config.example.json`          | Checked-in example config for local runs                                                                           |
| `scripts/review-loop/issue-schema.ts`              | Reviewer/verifier JSON schemas and parse helpers                                                                   |
| `scripts/review-loop/issue-fingerprint.ts`         | Stable issue identity hashing                                                                                      |
| `scripts/review-loop/run-state.ts`                 | Durable run directories, session ids, session-pointer files, and state persistence                                 |
| `scripts/review-loop/issue-ledger.ts`              | Issue merge/update persistence across rounds                                                                       |
| `scripts/review-loop/acp-process-client.ts`        | ACP subprocess spawn + SDK connection wrapper + transcript capture                                                 |
| `scripts/review-loop/agent-session.ts`             | Session bootstrap/load/new + text prompt helper                                                                    |
| `scripts/review-loop/available-commands.ts`        | Configured prefix resolution against advertised ACP commands                                                       |
| `scripts/review-loop/permission-policy.ts`         | Repo-local auto-allow/deny logic for ACP permission requests                                                       |
| `scripts/review-loop/prompt-templates.ts`          | Review / verify / fix / rereview prompt builders                                                                   |
| `scripts/review-loop/loop-controller.ts`           | Main workflow state machine                                                                                        |
| `scripts/review-loop/summary.ts`                   | Human-readable terminal and summary-file output                                                                    |
| `tests/review-loop/cli.test.ts`                    | Config/CLI tests                                                                                                   |
| `tests/review-loop/issue-schema.test.ts`           | Schema parse tests                                                                                                 |
| `tests/review-loop/run-state.test.ts`              | Run directory persistence tests                                                                                    |
| `tests/review-loop/issue-ledger.test.ts`           | Ledger state transition tests                                                                                      |
| `tests/review-loop/fake-agent.ts`                  | Minimal ACP fake agent for deterministic tests                                                                     |
| `tests/review-loop/acp-process-client.test.ts`     | ACP wrapper + session bootstrap tests                                                                              |
| `tests/review-loop/available-commands.test.ts`     | Prefix resolution tests                                                                                            |
| `tests/review-loop/permission-policy.test.ts`      | Allow/deny policy tests                                                                                            |
| `tests/review-loop/loop-controller.test.ts`        | Loop-state tests with mocked sessions                                                                              |
| `tests/review-loop/fake-agent-integration.test.ts` | End-to-end fake ACP integration test                                                                               |

---

### Task 1: Scaffold the review-loop CLI and config surface

**Files:**

- Modify: `package.json`
- Modify: `.gitignore`
- Create: `scripts/review-loop.ts`
- Create: `scripts/review-loop/config.ts`
- Create: `scripts/review-loop/cli.ts`
- Create: `scripts/review-loop/config.example.json`
- Test: `tests/review-loop/cli.test.ts`

- [ ] **Step 1: Write the failing CLI/config test**

```typescript
// tests/review-loop/cli.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadReviewLoopConfig } from '../../scripts/review-loop/config.js'
import { parseCliArgs } from '../../scripts/review-loop/cli.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-cli-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('review-loop CLI bootstrap', () => {
  test('parseCliArgs requires --plan and returns resume-run when provided', () => {
    expect(() => parseCliArgs(['--config', '.review-loop/config.json'])).toThrow('Missing required --plan')

    expect(
      parseCliArgs([
        '--config',
        '.review-loop/config.json',
        '--plan',
        'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md',
        '--resume-run',
        '2026-04-12T05-31-44Z',
      ]),
    ).toEqual({
      configPath: '.review-loop/config.json',
      planPath: 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md',
      repoRoot: undefined,
      resumeRunId: '2026-04-12T05-31-44Z',
    })
  })

  test('loadReviewLoopConfig resolves repo paths and creates workDir', async () => {
    const dir = makeTempDir()
    const configPath = path.join(dir, 'review-loop.config.json')

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          repoRoot: dir,
          workDir: path.join(dir, '.review-loop'),
          maxRounds: 5,
          maxNoProgressRounds: 2,
          reviewer: {
            command: '/usr/local/bin/claude-acp-adapter',
            args: [],
            invocationPrefix: '/review-code',
            requireInvocationPrefix: false,
          },
          fixer: {
            command: 'opencode',
            args: ['acp'],
            verifyInvocationPrefix: '/verify-issue',
            fixInvocationPrefix: null,
            requireVerifyInvocation: false,
          },
        },
        null,
        2,
      ),
    )

    const config = await loadReviewLoopConfig({
      configPath,
    })

    expect(config.repoRoot).toBe(dir)
    expect(config.workDir).toBe(path.join(dir, '.review-loop'))
    expect(config.reviewer.invocationPrefix).toBe('/review-code')
    expect(config.fixer.verifyInvocationPrefix).toBe('/verify-issue')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/review-loop/cli.test.ts --reporter=dot
```

Expected: FAIL with `Cannot find module '../../scripts/review-loop/config.js'` and `Cannot find module '../../scripts/review-loop/cli.js'`.

- [ ] **Step 3: Add the package and ignore-file wiring**

```json
// package.json
{
  "scripts": {
    "review:loop": "bun scripts/review-loop.ts",
    "test": "bun test tests/providers tests/tools tests/web tests/db tests/utils tests/schemas tests/proactive tests/debug tests/review-loop tests/*.test.ts"
  },
  "devDependencies": {
    "@agentclientprotocol/sdk": "^0.18.2"
  }
}
```

```gitignore
# .gitignore
.review-loop/
```

- [ ] **Step 4: Add the config schema and example config**

```typescript
// scripts/review-loop/config.ts
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

const ReviewerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  sessionConfig: z.record(z.string(), z.string()).default({}),
  invocationPrefix: z.string().nullable().default(null),
  requireInvocationPrefix: z.boolean().default(false),
})

const FixerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
  sessionConfig: z.record(z.string(), z.string()).default({}),
  verifyInvocationPrefix: z.string().nullable().default(null),
  fixInvocationPrefix: z.string().nullable().default(null),
  requireVerifyInvocation: z.boolean().default(false),
})

export const ReviewLoopConfigSchema = z.object({
  repoRoot: z.string().min(1),
  workDir: z.string().min(1),
  maxRounds: z.number().int().positive().default(5),
  maxNoProgressRounds: z.number().int().positive().default(2),
  reviewer: ReviewerConfigSchema,
  fixer: FixerConfigSchema,
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

```json
// scripts/review-loop/config.example.json
{
  "repoRoot": "/Users/ki/Projects/experiments/papai",
  "workDir": "/Users/ki/Projects/experiments/papai/.review-loop",
  "maxRounds": 5,
  "maxNoProgressRounds": 2,
  "reviewer": {
    "command": "/usr/local/bin/claude-acp-adapter",
    "args": [],
    "env": {},
    "sessionConfig": {},
    "invocationPrefix": "/review-code",
    "requireInvocationPrefix": false
  },
  "fixer": {
    "command": "opencode",
    "args": ["acp"],
    "env": {},
    "sessionConfig": {},
    "verifyInvocationPrefix": "/verify-issue",
    "fixInvocationPrefix": null,
    "requireVerifyInvocation": false
  }
}
```

- [ ] **Step 5: Add CLI arg parsing and the shebang entry point**

```typescript
// scripts/review-loop/cli.ts
import type { ReviewLoopConfig } from './config.js'
import { loadReviewLoopConfig } from './config.js'

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

export async function runCli(argv: readonly string[]): Promise<ReviewLoopConfig> {
  const args = parseCliArgs(argv)
  const config = await loadReviewLoopConfig({
    configPath: args.configPath,
    repoRoot: args.repoRoot,
  })
  console.log(`Loaded ACP review loop config for ${config.repoRoot}`)
  return config
}
```

```typescript
// scripts/review-loop.ts
#!/usr/bin/env bun
import { runCli } from './review-loop/cli.js'

await runCli(Bun.argv.slice(2))
```

- [ ] **Step 6: Run the test to verify it passes**

Run:

```bash
bun test tests/review-loop/cli.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore scripts/review-loop.ts scripts/review-loop/config.ts scripts/review-loop/cli.ts scripts/review-loop/config.example.json tests/review-loop/cli.test.ts
git commit -m "feat(scripts): scaffold ACP review loop CLI"
```

### Task 2: Add issue schemas, run-state persistence, and the durable ledger

**Files:**

- Create: `scripts/review-loop/issue-schema.ts`
- Create: `scripts/review-loop/issue-fingerprint.ts`
- Create: `scripts/review-loop/run-state.ts`
- Create: `scripts/review-loop/issue-ledger.ts`
- Test: `tests/review-loop/issue-schema.test.ts`
- Test: `tests/review-loop/run-state.test.ts`
- Test: `tests/review-loop/issue-ledger.test.ts`

- [ ] **Step 1: Write the failing schema, run-state, and ledger tests**

```typescript
// tests/review-loop/issue-schema.test.ts
import { describe, expect, test } from 'bun:test'

import { parseReviewerIssues, parseVerifierDecision } from '../../scripts/review-loop/issue-schema.js'

describe('issue schema parsing', () => {
  test('parseReviewerIssues accepts structured critical/high issues', () => {
    const parsed = parseReviewerIssues(
      JSON.stringify({
        round: 1,
        issues: [
          {
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
          },
        ],
      }),
    )

    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]?.severity).toBe('high')
  })

  test('parseVerifierDecision rejects freeform prose', () => {
    expect(() => parseVerifierDecision('looks valid to me')).toThrow('Unexpected token')
  })
})
```

```typescript
// tests/review-loop/run-state.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createRunState } from '../../scripts/review-loop/run-state.js'
import type { ReviewLoopConfig } from '../../scripts/review-loop/config.js'

const tempDirs: string[] = []

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-state-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createRunState creates the run directory, state file, and session pointer files', async () => {
  const repoRoot = makeTempDir()
  const config: ReviewLoopConfig = {
    repoRoot,
    workDir: path.join(repoRoot, '.review-loop'),
    maxRounds: 5,
    maxNoProgressRounds: 2,
    reviewer: {
      command: '/usr/local/bin/claude-acp-adapter',
      args: [],
      env: {},
      sessionConfig: {},
      invocationPrefix: '/review-code',
      requireInvocationPrefix: false,
    },
    fixer: {
      command: 'opencode',
      args: ['acp'],
      env: {},
      sessionConfig: {},
      verifyInvocationPrefix: '/verify-issue',
      fixInvocationPrefix: null,
      requireVerifyInvocation: false,
    },
  }

  const planPath = path.join(repoRoot, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md')
  const state = await createRunState(config, planPath)
  const persisted = JSON.parse(readFileSync(state.statePath, 'utf8')) as { planPath: string }

  expect(state.runDir.startsWith(path.join(config.workDir, 'runs'))).toBe(true)
  expect(persisted.planPath).toBe(planPath)
  expect(existsSync(state.reviewerSessionPath)).toBe(true)
  expect(existsSync(state.fixerSessionPath)).toBe(true)
})
```

```typescript
// tests/review-loop/issue-ledger.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createIssueLedger,
  applyReviewRound,
  recordVerification,
  recordFixAttempt,
  saveIssueLedger,
} from '../../scripts/review-loop/issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from '../../scripts/review-loop/issue-schema.js'

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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('issue ledger', () => {
  test('reopens closed issues when the reviewer reports them again', async () => {
    const runDir = mkdtempSync(path.join(tmpdir(), 'review-loop-ledger-'))
    tempDirs.push(runDir)

    const ledger = await createIssueLedger(runDir)
    const record = applyReviewRound(ledger, 1, [issue])[0]
    if (record === undefined) {
      throw new Error('Expected a ledger record')
    }

    const decision: VerifierDecision = {
      verdict: 'valid',
      fixability: 'auto',
      reasoning: 'The control flow is actually unsafe.',
      targetFiles: ['src/message-queue/queue.ts'],
      fixPlan: 'Take the lock before the flush branch.',
    }

    recordVerification(ledger, record.fingerprint, decision)
    recordFixAttempt(ledger, record.fingerprint)
    ledger.snapshot.issues[record.fingerprint]!.status = 'closed'
    applyReviewRound(ledger, 2, [issue])
    await saveIssueLedger(ledger)

    const persisted = JSON.parse(readFileSync(ledger.path, 'utf8')) as {
      issues: Record<string, { status: string; fixAttempts: number }>
    }

    expect(persisted.issues[record.fingerprint]?.status).toBe('reopened')
    expect(persisted.issues[record.fingerprint]?.fixAttempts).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/review-loop/issue-schema.test.ts tests/review-loop/run-state.test.ts tests/review-loop/issue-ledger.test.ts --reporter=dot
```

Expected: FAIL with missing modules under `scripts/review-loop/`.

- [ ] **Step 3: Add the reviewer/verifier schemas and the fingerprint helper**

```typescript
// scripts/review-loop/issue-schema.ts
import { z } from 'zod'

export const ReviewerIssueSchema = z.object({
  title: z.string().min(1),
  severity: z.enum(['critical', 'high']),
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
  round: z.number().int().nonnegative(),
  issues: z.array(ReviewerIssueSchema),
})

export const VerifierDecisionSchema = z.object({
  verdict: z.enum(['valid', 'invalid', 'already_fixed', 'needs_human']),
  fixability: z.enum(['auto', 'manual']),
  reasoning: z.string().min(1),
  targetFiles: z.array(z.string().min(1)),
  fixPlan: z.string().min(1),
})

export type ReviewerIssue = z.infer<typeof ReviewerIssueSchema>
export type ReviewerIssues = z.infer<typeof ReviewerIssuesSchema>
export type VerifierDecision = z.infer<typeof VerifierDecisionSchema>

export function parseReviewerIssues(text: string): ReviewerIssues {
  return ReviewerIssuesSchema.parse(JSON.parse(text))
}

export function parseVerifierDecision(text: string): VerifierDecision {
  return VerifierDecisionSchema.parse(JSON.parse(text))
}
```

```typescript
// scripts/review-loop/issue-fingerprint.ts
import { createHash } from 'node:crypto'

import type { ReviewerIssue } from './issue-schema.js'

const normalize = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const stripLineReferences = (value: string): string => value.replace(/\b(lines?|line)\s+\d+(?:\s*[-–]\s*\d+)?\b/gi, ' ')

export function computeIssueFingerprint(issue: ReviewerIssue): string {
  const source = [
    normalize(issue.file),
    normalize(issue.title),
    normalize(issue.summary),
    normalize(issue.whyItMatters),
    normalize(stripLineReferences(issue.evidence)),
  ].join('|')

  return createHash('sha256').update(source).digest('hex').slice(0, 16)
}
```

- [ ] **Step 4: Add run-state persistence**

```typescript
// scripts/review-loop/run-state.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { ReviewLoopConfig } from './config.js'

export interface RunState {
  runId: string
  runDir: string
  transcriptDir: string
  statePath: string
  reviewerSessionPath: string
  fixerSessionPath: string
  repoRoot: string
  planPath: string
  reviewerSessionId: string | null
  fixerSessionId: string | null
  currentRound: number
  noProgressRounds: number
}

const PersistedRunStateSchema = RunStateSchema.pick({
  runId: true,
  repoRoot: true,
  planPath: true,
  currentRound: true,
  noProgressRounds: true,
})

function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export async function createRunState(config: ReviewLoopConfig, planPath: string): Promise<RunState> {
  const runId = makeRunId()
  const runDir = path.join(config.workDir, 'runs', runId)
  const transcriptDir = path.join(runDir, 'transcripts')
  const statePath = path.join(runDir, 'state.json')
  const reviewerSessionPath = path.join(runDir, 'reviewer-session.json')
  const fixerSessionPath = path.join(runDir, 'fixer-session.json')

  await mkdir(transcriptDir, { recursive: true })

  const state: RunState = {
    runId,
    runDir,
    transcriptDir,
    statePath,
    reviewerSessionPath,
    fixerSessionPath,
    repoRoot: config.repoRoot,
    planPath,
    reviewerSessionId: null,
    fixerSessionId: null,
    currentRound: 0,
    noProgressRounds: 0,
  }

  await writeFile(reviewerSessionPath, JSON.stringify({ sessionId: null }, null, 2))
  await writeFile(fixerSessionPath, JSON.stringify({ sessionId: null }, null, 2))
  await saveRunState(state)
  return state
}

export async function loadRunState(workDir: string, runId: string): Promise<RunState> {
  const statePath = path.join(workDir, 'runs', runId, 'state.json')
  const runDir = path.dirname(statePath)
  const state = PersistedRunStateSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
  const transcriptDir = path.join(runDir, 'transcripts')
  const reviewerSessionPath = path.join(runDir, 'reviewer-session.json')
  const fixerSessionPath = path.join(runDir, 'fixer-session.json')
  return {
    ...state,
    runDir,
    transcriptDir,
    statePath,
    reviewerSessionPath,
    fixerSessionPath,
    reviewerSessionId: await readSessionPointer(reviewerSessionPath),
    fixerSessionId: await readSessionPointer(fixerSessionPath),
  }
}

export async function saveRunState(state: RunState): Promise<void> {
  const { reviewerSessionId: _reviewerSessionId, fixerSessionId: _fixerSessionId, ...persistedState } = state
  await writeFile(state.statePath, JSON.stringify(persistedState, null, 2))
  await writeFile(state.reviewerSessionPath, JSON.stringify({ sessionId: state.reviewerSessionId }, null, 2))
  await writeFile(state.fixerSessionPath, JSON.stringify({ sessionId: state.fixerSessionId }, null, 2))
}

async function readSessionPointer(pointerPath: string): Promise<string | null> {
  return SessionPointerSchema.parse(JSON.parse(await readFile(pointerPath, 'utf8'))).sessionId
}
```

- [ ] **Step 5: Add the durable ledger**

```typescript
// scripts/review-loop/issue-ledger.ts
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { computeIssueFingerprint } from './issue-fingerprint.js'
import type { ReviewerIssue, VerifierDecision } from './issue-schema.js'

export type LedgerIssueStatus =
  | 'discovered'
  | 'verified'
  | 'rejected'
  | 'already_fixed'
  | 'needs_human'
  | 'fixed_pending_review'
  | 'closed'
  | 'reopened'

export interface LedgerIssueRecord {
  fingerprint: string
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
  const snapshot = IssueLedgerSnapshotSchema.parse(JSON.parse(await Bun.file(ledgerPath).text()))
  return {
    path: ledgerPath,
    snapshot,
  }
}

export function applyReviewRound(
  ledger: IssueLedger,
  round: number,
  issues: readonly ReviewerIssue[],
): readonly LedgerIssueRecord[] {
  const seenFingerprints = new Set<string>()
  const roundRecords: LedgerIssueRecord[] = []

  for (const issue of issues) {
    const fingerprint = computeIssueFingerprint(issue)
    if (seenFingerprints.has(fingerprint)) {
      continue
    }
    seenFingerprints.add(fingerprint)

    const existing = ledger.snapshot.issues[fingerprint]

    const next: LedgerIssueRecord =
      existing === undefined
        ? {
            fingerprint,
            issue,
            status: 'discovered',
            firstSeenRound: round,
            latestSeenRound: round,
            fixAttempts: 0,
            verifierDecision: null,
          }
        : {
            ...existing,
            issue,
            latestSeenRound: round,
            status:
              existing.status === 'closed' || existing.status === 'fixed_pending_review' ? 'reopened' : existing.status,
          }

    ledger.snapshot.issues[fingerprint] = next
    roundRecords.push(next)
  }

  return roundRecords
}

export function recordVerification(ledger: IssueLedger, fingerprint: string, decision: VerifierDecision): void {
  const record = ledger.snapshot.issues[fingerprint]
  if (record === undefined) {
    throw new Error(`Unknown issue fingerprint ${fingerprint}`)
  }

  record.verifierDecision = decision
  record.status = mapVerifierDecisionToLedgerStatus(decision.verdict)
}

export function recordFixAttempt(ledger: IssueLedger, fingerprint: string): void {
  const record = ledger.snapshot.issues[fingerprint]
  if (record === undefined) {
    throw new Error(`Unknown issue fingerprint ${fingerprint}`)
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
    case 'invalid':
      return 'rejected'
    case 'already_fixed':
      return 'already_fixed'
    case 'needs_human':
      return 'needs_human'
    default:
      throw new Error('Unhandled verifier verdict')
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
bun test tests/review-loop/issue-schema.test.ts tests/review-loop/run-state.test.ts tests/review-loop/issue-ledger.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/review-loop/issue-schema.ts scripts/review-loop/issue-fingerprint.ts scripts/review-loop/run-state.ts scripts/review-loop/issue-ledger.ts tests/review-loop/issue-schema.test.ts tests/review-loop/run-state.test.ts tests/review-loop/issue-ledger.test.ts
git commit -m "feat(scripts): add review-loop issue contracts and ledger"
```

### Task 3: Build the ACP subprocess wrapper and session bootstrap

**Files:**

- Create: `scripts/review-loop/acp-process-client.ts`
- Create: `scripts/review-loop/agent-session.ts`
- Test: `tests/review-loop/fake-agent.ts`
- Test: `tests/review-loop/acp-process-client.test.ts`

- [ ] **Step 1: Write the failing ACP wrapper test**

```typescript
// tests/review-loop/acp-process-client.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync as readFileSyncNode, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createAcpProcessClient } from '../../scripts/review-loop/acp-process-client.js'
import { bootstrapAgentSession } from '../../scripts/review-loop/agent-session.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('ACP process client', () => {
  test('initializes the subprocess, creates a session, and collects text replies', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'review-loop-acp-'))
    tempDirs.push(tempDir)

    const scenarioPath = path.join(tempDir, 'reviewer-scenario.json')
    const transcriptPath = path.join(tempDir, 'reviewer.ndjson')
    writeFileSync(
      scenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [{ text: '{"round":1,"issues":[]}' }],
        },
        null,
        2,
      ),
    )

    const client = await createAcpProcessClient({
      command: 'bun',
      args: ['tests/review-loop/fake-agent.ts'],
      cwd: process.cwd(),
      env: { ...process.env, ACP_SCENARIO_FILE: scenarioPath },
      transcriptPath,
    })

    const session = await bootstrapAgentSession(client, {
      cwd: process.cwd(),
      previousSessionId: null,
      sessionConfig: {},
    })

    expect(session.availableCommands).toEqual(['review-code'])

    const reply = await session.promptText('/review-code review the current diff')
    expect(reply.stopReason).toBe('end_turn')
    expect(reply.text).toContain('"issues":[]')
    expect(readFileSyncNode(transcriptPath, 'utf8')).toContain('"sessionUpdate":"agent_message_chunk"')

    await client.close()
  })
})
```

- [ ] **Step 2: Run the ACP wrapper test to verify it fails**

Run:

```bash
bun test tests/review-loop/acp-process-client.test.ts --reporter=dot
```

Expected: FAIL with missing `acp-process-client.js`, `agent-session.js`, and `tests/review-loop/fake-agent.ts`.

- [ ] **Step 3: Add the deterministic fake ACP agent**

```typescript
// tests/review-loop/fake-agent.ts
#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import readline from 'node:readline'

interface Scenario {
  availableCommands: Array<{ name: string; description: string }>
  promptReplies: Array<{ text: string }>
}

const scenarioPath = process.env.ACP_SCENARIO_FILE
if (scenarioPath === undefined) {
  throw new Error('ACP_SCENARIO_FILE is required')
}

const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8')) as Scenario
let promptIndex = 0

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
})

rl.on('line', (line) => {
  const message = JSON.parse(line) as { id?: number; method: string; params?: Record<string, unknown> }

  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
        },
        authMethods: [],
      },
    })
    return
  }

  if (message.method === 'session/new') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'sess_fake' },
    })
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'sess_fake',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: scenario.availableCommands,
        },
      },
    })
    return
  }

  if (message.method === 'session/load') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: null,
    })
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: message.params?.sessionId ?? 'sess_fake',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: scenario.availableCommands,
        },
      },
    })
    return
  }

  if (message.method === 'session/prompt') {
    const promptReply = scenario.promptReplies[promptIndex] ?? scenario.promptReplies.at(-1) ?? { text: '' }
    promptIndex += 1

    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: message.params?.sessionId ?? 'sess_fake',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: promptReply.text,
          },
        },
      },
    })

    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        stopReason: 'end_turn',
      },
    })
  }
})
```

- [ ] **Step 4: Add the ACP process wrapper**

```typescript
// scripts/review-loop/acp-process-client.ts
import { appendFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

export interface AcpProcessSpec {
  command: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  transcriptPath: string
}

export interface AcpProcessClient {
  initialize(): Promise<void>
  newSession(cwd: string): Promise<{ sessionId: string }>
  loadSession(sessionId: string, cwd: string): Promise<void>
  setConfigOption(sessionId: string, configId: string, value: string): Promise<void>
  prompt(sessionId: string, text: string): Promise<{ stopReason: string }>
  onSessionUpdate(listener: (params: acp.SessionNotification) => void): void
  close(): Promise<void>
}

export async function createAcpProcessClient(spec: AcpProcessSpec): Promise<AcpProcessClient> {
  const processHandle = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  })

  const listeners: Array<(params: acp.SessionNotification) => void> = []

  async function appendTranscript(direction: 'in' | 'out', payload: unknown): Promise<void> {
    await appendFile(spec.transcriptPath, `${JSON.stringify({ direction, payload })}\n`)
  }

  const runtimeClient = {
    async sessionUpdate(params: acp.SessionNotification): Promise<void> {
      await appendTranscript('in', params)
      for (const listener of listeners) {
        listener(params)
      }
    },
    async requestPermission(): Promise<acp.RequestPermissionResponse> {
      throw new Error('Permission handling is wired in Task 4')
    },
  }

  const stream = acp.ndJsonStream(
    Writable.toWeb(processHandle.stdin!),
    Readable.toWeb(processHandle.stdout!) as ReadableStream<Uint8Array>,
  )

  const connection = new acp.ClientSideConnection(() => runtimeClient, stream)

  return {
    async initialize(): Promise<void> {
      await appendTranscript('out', { method: 'initialize' })
      await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
    },
    async newSession(cwd: string): Promise<{ sessionId: string }> {
      await appendTranscript('out', { method: 'session/new', cwd })
      return connection.newSession({ cwd, mcpServers: [] })
    },
    async loadSession(sessionId: string, cwd: string): Promise<void> {
      await appendTranscript('out', { method: 'session/load', sessionId, cwd })
      await connection.loadSession({ sessionId, cwd, mcpServers: [] })
    },
    async setConfigOption(sessionId: string, configId: string, value: string): Promise<void> {
      await appendTranscript('out', { method: 'session/set_config_option', sessionId, configId, value })
      await connection.setSessionConfigOption({ sessionId, configId, value })
    },
    async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
      await appendTranscript('out', { method: 'session/prompt', sessionId, text })
      return connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text }],
      })
    },
    onSessionUpdate(listener: (params: acp.SessionNotification) => void): void {
      listeners.push(listener)
    },
    async close(): Promise<void> {
      processHandle.kill()
    },
  }
}
```

- [ ] **Step 5: Add the session bootstrap helper**

```typescript
// scripts/review-loop/agent-session.ts
import type { AcpProcessClient } from './acp-process-client.js'

export interface AgentPromptReply {
  text: string
  stopReason: string
}

export interface BootstrappedAgentSession {
  sessionId: string
  availableCommands: string[]
  promptText(text: string): Promise<AgentPromptReply>
}

export async function bootstrapAgentSession(
  client: AcpProcessClient,
  options: {
    cwd: string
    previousSessionId: string | null
    sessionConfig: Record<string, string>
  },
): Promise<BootstrappedAgentSession> {
  await client.initialize()

  const availableCommands: string[] = []
  let responseChunks: string[] = []

  client.onSessionUpdate((params) => {
    const update = params.update
    if (update.sessionUpdate === 'available_commands_update') {
      availableCommands.splice(0, availableCommands.length, ...update.availableCommands.map((command) => command.name))
      return
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      responseChunks.push(update.content.text)
    }
  })

  const sessionId =
    options.previousSessionId === null
      ? (await client.newSession(options.cwd)).sessionId
      : (await client.loadSession(options.previousSessionId, options.cwd), options.previousSessionId)

  for (const [configId, value] of Object.entries(options.sessionConfig)) {
    await client.setConfigOption(sessionId, configId, value)
  }

  return {
    sessionId,
    availableCommands,
    async promptText(text: string): Promise<AgentPromptReply> {
      responseChunks = []
      const result = await client.prompt(sessionId, text)
      return {
        text: responseChunks.join(''),
        stopReason: result.stopReason,
      }
    },
  }
}
```

- [ ] **Step 6: Run the ACP wrapper test to verify it passes**

Run:

```bash
bun test tests/review-loop/acp-process-client.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/review-loop/acp-process-client.ts scripts/review-loop/agent-session.ts tests/review-loop/fake-agent.ts tests/review-loop/acp-process-client.test.ts
git commit -m "feat(scripts): add ACP subprocess wrapper"
```

### Task 4: Add command-resolution, permission policy, and prompt builders

**Files:**

- Modify: `scripts/review-loop/acp-process-client.ts`
- Create: `scripts/review-loop/available-commands.ts`
- Create: `scripts/review-loop/permission-policy.ts`
- Create: `scripts/review-loop/prompt-templates.ts`
- Test: `tests/review-loop/available-commands.test.ts`
- Test: `tests/review-loop/permission-policy.test.ts`

- [ ] **Step 1: Write the failing command-resolution and permission-policy tests**

```typescript
// tests/review-loop/available-commands.test.ts
import { describe, expect, test } from 'bun:test'

import { resolveInvocationText } from '../../scripts/review-loop/available-commands.js'

describe('resolveInvocationText', () => {
  test('uses the slash command prefix only when the command is advertised', () => {
    expect(resolveInvocationText('/verify-issue', ['verify-issue'], 'Issue body', false)).toBe(
      '/verify-issue Issue body',
    )

    expect(resolveInvocationText('/verify-issue', [], 'Issue body', false)).toBe('Issue body')
  })

  test('throws when a required slash command is missing', () => {
    expect(() => resolveInvocationText('/review-code', [], 'Issue body', true)).toThrow(
      'Required command /review-code is not advertised by the agent',
    )
  })
})
```

```typescript
// tests/review-loop/permission-policy.test.ts
import { describe, expect, test } from 'bun:test'

import { decidePermissionOptionId } from '../../scripts/review-loop/permission-policy.js'

const options = [
  { optionId: 'allow-once', kind: 'allow_once' as const },
  { optionId: 'reject-once', kind: 'reject_once' as const },
]

describe('decidePermissionOptionId', () => {
  test('allows repo-local edits and safe execute commands', () => {
    expect(
      decidePermissionOptionId(
        {
          title: 'Edit queue.ts',
          kind: 'edit',
          locations: [{ path: '/repo/src/message-queue/queue.ts' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Run tests',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'bun test tests/review-loop/loop-controller.test.ts --reporter=dot' },
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')
  })

  test('rejects writes outside the repo and destructive commands', () => {
    expect(
      decidePermissionOptionId(
        {
          title: 'Edit /tmp/file.ts',
          kind: 'edit',
          locations: [{ path: '/tmp/file.ts' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Reset repo',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'git reset --hard HEAD' },
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/review-loop/available-commands.test.ts tests/review-loop/permission-policy.test.ts --reporter=dot
```

Expected: FAIL with missing helper modules.

- [ ] **Step 3: Add invocation-prefix resolution**

```typescript
// scripts/review-loop/available-commands.ts
export function resolveInvocationText(
  prefix: string | null,
  availableCommands: readonly string[],
  body: string,
  required: boolean,
): string {
  if (prefix === null) {
    return body
  }

  if (!prefix.startsWith('/')) {
    return `${prefix}\n\n${body}`
  }

  const commandName = prefix.slice(1).split(/\s+/, 1)[0] ?? ''
  if (availableCommands.length === 0) {
    if (required) {
      throw new Error(`Required command /${commandName} is not advertised by the agent`)
    }
    return body
  }

  if (availableCommands.includes(commandName)) {
    return `${prefix} ${body}`.trim()
  }

  if (required) {
    throw new Error(`Required command /${commandName} is not advertised by the agent`)
  }

  return body
}
```

- [ ] **Step 4: Add the permission policy**

```typescript
// scripts/review-loop/permission-policy.ts
import path from 'node:path'

export interface PermissionOption {
  optionId: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface PermissionRequestLike {
  title: string
  kind: string
  locations: Array<{ path: string }>
  rawInput: Record<string, unknown>
  options: readonly PermissionOption[]
}

const SAFE_EXECUTE_PATTERNS = [
  /^git (status|diff|show)\b/,
  /^bun test\b/,
  /^bun run (typecheck|lint|format:check|check:full)\b/,
  /^oxfmt\b/,
  /^oxlint\b/,
]

function isRepoPath(repoRoot: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(repoRoot)
  const resolvedCandidate = path.resolve(candidatePath)
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
}

function chooseOption(options: readonly PermissionOption[], kind: 'allow' | 'reject'): string {
  const match = options.find((option) =>
    kind === 'allow'
      ? option.kind === 'allow_once' || option.kind === 'allow_always'
      : option.kind === 'reject_once' || option.kind === 'reject_always',
  )

  if (match === undefined) {
    throw new Error(`No ${kind} option provided by the ACP agent`)
  }

  return match.optionId
}

export function decidePermissionOptionId(request: PermissionRequestLike, repoRoot: string): string {
  if (request.kind === 'edit' || request.kind === 'read' || request.kind === 'search') {
    const allPathsSafe = request.locations.every((location) => isRepoPath(repoRoot, location.path))
    return chooseOption(request.options, allPathsSafe ? 'allow' : 'reject')
  }

  if (request.kind === 'execute') {
    const command = String(request.rawInput.command ?? '')
    const isSafe = SAFE_EXECUTE_PATTERNS.some((pattern) => pattern.test(command))
    return chooseOption(request.options, isSafe ? 'allow' : 'reject')
  }

  return chooseOption(request.options, 'reject')
}
```

```typescript
// scripts/review-loop/acp-process-client.ts
import type { PermissionRequestLike } from './permission-policy.js'

export interface AcpProcessSpec {
  command: string
  args: readonly string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  selectPermissionOptionId?: (request: PermissionRequestLike) => string
}

const runtimeClient = {
  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    for (const listener of listeners) {
      listener(params)
    }
  },
  async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    if (spec.selectPermissionOptionId === undefined) {
      throw new Error('No ACP permission handler configured')
    }

    const optionId = spec.selectPermissionOptionId({
      title: params.toolCall.title ?? '',
      kind: params.toolCall.kind ?? 'other',
      locations: (params.toolCall.locations ?? []).map((location) => ({ path: location.path })),
      rawInput:
        params.toolCall.rawInput !== null && typeof params.toolCall.rawInput === 'object'
          ? (params.toolCall.rawInput as Record<string, unknown>)
          : {},
      options: params.options.map((option) => ({
        optionId: option.optionId,
        kind: option.kind,
      })),
    })

    return {
      outcome: {
        outcome: 'selected',
        optionId,
      },
    }
  },
}
```

- [ ] **Step 5: Add the prompt builders**

```typescript
// scripts/review-loop/prompt-templates.ts
import type { LedgerIssueRecord } from './issue-ledger.js'
import type { ReviewerIssue, VerifierDecision } from './issue-schema.js'

function summarizeLedger(records: readonly LedgerIssueRecord[]): string {
  if (records.length === 0) {
    return 'No prior issues recorded.'
  }

  return records.map((record) => `- ${record.fingerprint} [${record.status}] ${record.issue.title}`).join('\n')
}

export function buildReviewPrompt(planPath: string, ledgerRecords: readonly LedgerIssueRecord[]): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    'Return JSON only.',
    'Only include severity critical or high findings.',
    'Use this exact schema:',
    '{"round": number, "issues": [{"title": string, "severity": "critical" | "high", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number}]}',
    'Prior issue ledger:',
    summarizeLedger(ledgerRecords),
  ].join('\n\n')
}

export function buildVerifyPrompt(planPath: string, issue: ReviewerIssue): string {
  return [
    `Verify this issue against the implementation plan at: ${planPath}.`,
    'Return JSON only.',
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixPlan": string}',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, decision: VerifierDecision): string {
  return [
    'Fix exactly the verified issue below.',
    'Keep the fix minimal and do not broaden scope unless required for correctness.',
    'You may run targeted repo-safe tests or formatters.',
    'Issue:',
    JSON.stringify(issue, null, 2),
    'Verifier decision:',
    JSON.stringify(decision, null, 2),
  ].join('\n\n')
}

export function buildRereviewPrompt(planPath: string, ledgerRecords: readonly LedgerIssueRecord[]): string {
  return [
    `Re-review the current implementation against the implementation plan at: ${planPath}.`,
    'Return JSON only with remaining critical/high issues.',
    'Confirm whether previously fixed issues are resolved and report only unresolved or newly introduced critical/high issues.',
    'Use the same schema as the original review prompt.',
    'Current issue ledger:',
    summarizeLedger(ledgerRecords),
  ].join('\n\n')
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
bun test tests/review-loop/available-commands.test.ts tests/review-loop/permission-policy.test.ts --reporter=dot
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/review-loop/available-commands.ts scripts/review-loop/permission-policy.ts scripts/review-loop/prompt-templates.ts tests/review-loop/available-commands.test.ts tests/review-loop/permission-policy.test.ts
git commit -m "feat(scripts): add review-loop policy and prompt helpers"
```

### Task 5: Implement the loop controller, CLI wiring, and end-to-end fake integration

**Files:**

- Create: `scripts/review-loop/loop-controller.ts`
- Create: `scripts/review-loop/summary.ts`
- Modify: `scripts/review-loop/cli.ts`
- Test: `tests/review-loop/loop-controller.test.ts`
- Test: `tests/review-loop/fake-agent-integration.test.ts`

- [ ] **Step 1: Write the failing loop-controller and fake integration tests**

```typescript
// tests/review-loop/loop-controller.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createIssueLedger } from '../../scripts/review-loop/issue-ledger.js'
import { runReviewLoop } from '../../scripts/review-loop/loop-controller.js'
import { createRunState } from '../../scripts/review-loop/run-state.js'
import type { ReviewLoopConfig } from '../../scripts/review-loop/config.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('runReviewLoop', () => {
  test('stops cleanly when rereview returns no critical/high issues', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'review-loop-controller-'))
    tempDirs.push(repoRoot)
    const planPath = path.join(repoRoot, 'docs/superpowers/plans/2026-04-11-file-attachments-implementation.md')

    const config: ReviewLoopConfig = {
      repoRoot,
      workDir: path.join(repoRoot, '.review-loop'),
      maxRounds: 5,
      maxNoProgressRounds: 2,
      reviewer: {
        command: '/usr/local/bin/claude-acp-adapter',
        args: [],
        env: {},
        sessionConfig: {},
        invocationPrefix: '/review-code',
        requireInvocationPrefix: false,
      },
      fixer: {
        command: 'opencode',
        args: ['acp'],
        env: {},
        sessionConfig: {},
        verifyInvocationPrefix: '/verify-issue',
        fixInvocationPrefix: null,
        requireVerifyInvocation: false,
      },
    }

    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    const reviewerReplies = [
      JSON.stringify({
        round: 1,
        issues: [
          {
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
          },
        ],
      }),
      JSON.stringify({ round: 2, issues: [] }),
    ]

    const fixerReplies = [
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'The control flow is actually unsafe.',
        targetFiles: ['src/message-queue/queue.ts'],
        fixPlan: 'Take the lock before the flush branch.',
      }),
      'Applied the minimal fix and ran the targeted test.',
    ]

    let reviewerIndex = 0
    let fixerIndex = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: async () => ({
          text: reviewerReplies[reviewerIndex++] ?? JSON.stringify({ round: 999, issues: [] }),
          stopReason: 'end_turn',
        }),
      },
      fixer: {
        availableCommands: ['verify-issue'],
        promptText: async () => ({
          text: fixerReplies[fixerIndex++] ?? 'done',
          stopReason: 'end_turn',
        }),
      },
    })

    expect(result.doneReason).toBe('clean')
    expect(result.rounds).toBe(1)
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'closed')).toBe(true)
  })
})
```

```typescript
// tests/review-loop/fake-agent-integration.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runCli } from '../../scripts/review-loop/cli.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('review-loop fake integration', () => {
  test('writes summary, transcript, and session files for a clean fake-agent run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'review-loop-integration-'))
    tempDirs.push(dir)

    const reviewerScenarioPath = path.join(dir, 'reviewer.json')
    const fixerScenarioPath = path.join(dir, 'fixer.json')
    const configPath = path.join(dir, 'config.json')
    const planPath = path.join(dir, 'plan.md')

    writeFileSync(planPath, '# Implementation plan\n')
    writeFileSync(
      reviewerScenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'review-code', description: 'Review code' }],
          promptReplies: [
            {
              text: '{"round":1,"issues":[{"title":"Race condition in queue flush path","severity":"high","summary":"Two concurrent messages can bypass the intended lock.","whyItMatters":"This can produce stale assistant replies.","evidence":"src/message-queue/queue.ts lines 84-107","file":"src/message-queue/queue.ts","lineStart":84,"lineEnd":107,"suggestedFix":"Take the processing lock earlier.","confidence":0.92}]}',
            },
            { text: '{"round":2,"issues":[]}' },
          ],
        },
        null,
        2,
      ),
    )
    writeFileSync(
      fixerScenarioPath,
      JSON.stringify(
        {
          availableCommands: [{ name: 'verify-issue', description: 'Verify issue' }],
          promptReplies: [
            {
              text: '{"verdict":"valid","fixability":"auto","reasoning":"The control flow is actually unsafe.","targetFiles":["src/message-queue/queue.ts"],"fixPlan":"Take the lock before the flush branch."}',
            },
            { text: 'Applied fix.' },
          ],
        },
        null,
        2,
      ),
    )
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          repoRoot: process.cwd(),
          workDir: path.join(dir, '.review-loop'),
          maxRounds: 5,
          maxNoProgressRounds: 2,
          reviewer: {
            command: 'bun',
            args: ['tests/review-loop/fake-agent.ts'],
            env: { ACP_SCENARIO_FILE: reviewerScenarioPath },
            sessionConfig: {},
            invocationPrefix: '/review-code',
            requireInvocationPrefix: false,
          },
          fixer: {
            command: 'bun',
            args: ['tests/review-loop/fake-agent.ts'],
            env: { ACP_SCENARIO_FILE: fixerScenarioPath },
            sessionConfig: {},
            verifyInvocationPrefix: '/verify-issue',
            fixInvocationPrefix: null,
            requireVerifyInvocation: false,
          },
        },
        null,
        2,
      ),
    )

    await runCli(['--config', configPath, '--plan', planPath])

    const runRoot = path.join(dir, '.review-loop', 'runs')
    const runId = readdirSync(runRoot)[0]
    if (runId === undefined) {
      throw new Error('Expected a fake run directory')
    }
    const summary = readFileSync(path.join(runRoot, runId, 'summary.txt'), 'utf8')
    const reviewerTranscript = readFileSync(path.join(runRoot, runId, 'transcripts', 'reviewer.ndjson'), 'utf8')
    const reviewerSession = readFileSync(path.join(runRoot, runId, 'reviewer-session.json'), 'utf8')

    expect(summary).toContain('Done reason: clean')
    expect(reviewerTranscript).toContain('"sessionUpdate":"agent_message_chunk"')
    expect(reviewerSession).toContain('"sessionId"')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/review-loop/loop-controller.test.ts tests/review-loop/fake-agent-integration.test.ts --reporter=dot
```

Expected: FAIL with missing `loop-controller.js` and missing CLI orchestration behavior.

- [ ] **Step 3: Add the loop controller and summary formatter**

```typescript
// scripts/review-loop/loop-controller.ts
import { resolveInvocationText } from './available-commands.js'
import type { ReviewLoopConfig } from './config.js'
import {
  applyReviewRound,
  recordFixAttempt,
  recordVerification,
  saveIssueLedger,
  type IssueLedger,
} from './issue-ledger.js'
import { computeIssueFingerprint } from './issue-fingerprint.js'
import { parseReviewerIssues, parseVerifierDecision } from './issue-schema.js'
import { buildFixPrompt, buildReviewPrompt, buildRereviewPrompt, buildVerifyPrompt } from './prompt-templates.js'
import { saveRunState, type RunState } from './run-state.js'

export interface PromptingSession {
  availableCommands: string[]
  promptText(text: string): Promise<{ text: string; stopReason: string }>
}

export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  reviewer: PromptingSession
  fixer: PromptingSession
}

export interface ReviewLoopResult {
  doneReason: 'clean' | 'max_rounds' | 'no_progress'
  rounds: number
  ledger: IssueLedger['snapshot']
}

export async function runReviewLoop(deps: ReviewLoopDeps): Promise<ReviewLoopResult> {
  let noProgressRounds = deps.runState.noProgressRounds

  while (deps.runState.currentRound < deps.config.maxRounds) {
    deps.runState.currentRound += 1
    const round = deps.runState.currentRound

    const reviewPrompt = resolveInvocationText(
      deps.config.reviewer.invocationPrefix,
      deps.reviewer.availableCommands,
      buildReviewPrompt(deps.runState.planPath, Object.values(deps.ledger.snapshot.issues)),
      deps.config.reviewer.requireInvocationPrefix,
    )
    const reviewResponse = parseReviewerIssues((await deps.reviewer.promptText(reviewPrompt)).text)
    const records = [...applyReviewRound(deps.ledger, round, reviewResponse.issues)]
    await saveIssueLedger(deps.ledger)

    if (records.length === 0) {
      await saveRunState(deps.runState)
      return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
    }

    let fixedThisRound = 0

    for (const record of records) {
      const verifyPrompt = resolveInvocationText(
        deps.config.fixer.verifyInvocationPrefix,
        deps.fixer.availableCommands,
        buildVerifyPrompt(deps.runState.planPath, record.issue),
        deps.config.fixer.requireVerifyInvocation,
      )
      const verifyDecision = parseVerifierDecision((await deps.fixer.promptText(verifyPrompt)).text)
      recordVerification(deps.ledger, record.fingerprint, verifyDecision)

      if (verifyDecision.verdict === 'valid' && verifyDecision.fixability === 'auto') {
        await deps.fixer.promptText(buildFixPrompt(record.issue, verifyDecision))
        recordFixAttempt(deps.ledger, record.fingerprint)
        fixedThisRound += 1
      }
    }

    const rereviewResponse = parseReviewerIssues(
      (
        await deps.reviewer.promptText(
          buildRereviewPrompt(deps.runState.planPath, Object.values(deps.ledger.snapshot.issues)),
        )
      ).text,
    )

    const unresolvedFingerprints = new Set(rereviewResponse.issues.map((issue) => computeIssueFingerprint(issue)))
    applyReviewRound(deps.ledger, round, rereviewResponse.issues)

    for (const record of Object.values(deps.ledger.snapshot.issues)) {
      if (record.status === 'fixed_pending_review' && !unresolvedFingerprints.has(record.fingerprint)) {
        record.status = 'closed'
      }
    }

    if (rereviewResponse.issues.length === 0) {
      await saveIssueLedger(deps.ledger)
      await saveRunState(deps.runState)
      return { doneReason: 'clean', rounds: round, ledger: deps.ledger.snapshot }
    }

    noProgressRounds = fixedThisRound === 0 ? noProgressRounds + 1 : 0
    deps.runState.noProgressRounds = noProgressRounds
    await saveRunState(deps.runState)
    await saveIssueLedger(deps.ledger)

    if (noProgressRounds >= deps.config.maxNoProgressRounds) {
      return { doneReason: 'no_progress', rounds: round, ledger: deps.ledger.snapshot }
    }
  }

  return {
    doneReason: 'max_rounds',
    rounds: deps.runState.currentRound,
    ledger: deps.ledger.snapshot,
  }
}
```

```typescript
// scripts/review-loop/summary.ts
import type { ReviewLoopResult } from './loop-controller.js'

export function formatSummary(result: ReviewLoopResult): string {
  const records = Object.values(result.ledger.issues)
  const counts = {
    closed: records.filter((record) => record.status === 'closed').length,
    rejected: records.filter((record) => record.status === 'rejected').length,
    needsHuman: records.filter((record) => record.status === 'needs_human').length,
    reopened: records.filter((record) => record.status === 'reopened').length,
  }

  return [
    `Done reason: ${result.doneReason}`,
    `Rounds executed: ${result.rounds}`,
    `Closed issues: ${counts.closed}`,
    `Rejected issues: ${counts.rejected}`,
    `Needs human: ${counts.needsHuman}`,
    `Reopened issues: ${counts.reopened}`,
  ].join('\n')
}
```

- [ ] **Step 4: Wire the CLI to run the full workflow and persist the summary**

```typescript
// scripts/review-loop/cli.ts
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createAcpProcessClient } from './acp-process-client.js'
import { bootstrapAgentSession } from './agent-session.js'
import { loadReviewLoopConfig } from './config.js'
import { createIssueLedger, loadIssueLedger } from './issue-ledger.js'
import { runReviewLoop } from './loop-controller.js'
import { decidePermissionOptionId } from './permission-policy.js'
import { createRunState, loadRunState, saveRunState, type RunState } from './run-state.js'
import { formatSummary } from './summary.js'

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

  const ledger =
    args.resumeRunId === undefined ? await createIssueLedger(runState.runDir) : await loadIssueLedger(runState.runDir)

  const reviewerClient = await createAcpProcessClient({
    command: config.reviewer.command,
    args: config.reviewer.args,
    cwd: config.repoRoot,
    env: { ...process.env, ...config.reviewer.env },
    transcriptPath: path.join(runState.transcriptDir, 'reviewer.ndjson'),
    selectPermissionOptionId: (request) => decidePermissionOptionId(request, config.repoRoot),
  })
  const fixerClient = await createAcpProcessClient({
    command: config.fixer.command,
    args: config.fixer.args,
    cwd: config.repoRoot,
    env: { ...process.env, ...config.fixer.env },
    transcriptPath: path.join(runState.transcriptDir, 'fixer.ndjson'),
    selectPermissionOptionId: (request) => decidePermissionOptionId(request, config.repoRoot),
  })

  const reviewerSession = await bootstrapAgentSession(reviewerClient, {
    cwd: config.repoRoot,
    previousSessionId: runState.reviewerSessionId,
    sessionConfig: config.reviewer.sessionConfig,
  })
  const fixerSession = await bootstrapAgentSession(fixerClient, {
    cwd: config.repoRoot,
    previousSessionId: runState.fixerSessionId,
    sessionConfig: config.fixer.sessionConfig,
  })

  runState.reviewerSessionId = reviewerSession.sessionId
  runState.fixerSessionId = fixerSession.sessionId
  await writeFile(runState.reviewerSessionPath, JSON.stringify({ sessionId: reviewerSession.sessionId }, null, 2))
  await writeFile(runState.fixerSessionPath, JSON.stringify({ sessionId: fixerSession.sessionId }, null, 2))
  await saveRunState(runState)

  try {
    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: reviewerSession,
      fixer: fixerSession,
    })

    const summary = formatSummary(result)
    await writeFile(path.join(runState.runDir, 'summary.txt'), `${summary}\n`)
    console.log(summary)
  } finally {
    await reviewerClient.close()
    await fixerClient.close()
  }
}
```

- [ ] **Step 5: Run the targeted tests and typecheck**

Run:

```bash
bun test tests/review-loop/loop-controller.test.ts tests/review-loop/fake-agent-integration.test.ts --reporter=dot
bun run typecheck
```

Expected: PASS

- [ ] **Step 6: Run the full repo check**

Run:

```bash
bun run check:full
```

Expected: PASS

- [ ] **Step 7: Run the local smoke test**

Create a local config file with real agent commands:

```bash
mkdir -p .review-loop
cat > .review-loop/config.json <<'EOF'
{
  "repoRoot": "/Users/ki/Projects/experiments/papai",
  "workDir": "/Users/ki/Projects/experiments/papai/.review-loop",
  "maxRounds": 5,
  "maxNoProgressRounds": 2,
  "reviewer": {
    "command": "/usr/local/bin/claude-acp-adapter",
    "args": [],
    "env": {},
    "sessionConfig": {},
    "invocationPrefix": "/review-code",
    "requireInvocationPrefix": false
  },
  "fixer": {
    "command": "opencode",
    "args": ["acp"],
    "env": {},
    "sessionConfig": {},
    "verifyInvocationPrefix": "/verify-issue",
    "fixInvocationPrefix": null,
    "requireVerifyInvocation": false
  }
}
EOF

bun run review:loop --config .review-loop/config.json --plan docs/superpowers/plans/2026-04-11-file-attachments-implementation.md
```

Expected:

- the CLI prints a final summary beginning with `Done reason:`
- `.review-loop/runs/<timestamp>/summary.txt` exists
- `.review-loop/runs/<timestamp>/ledger.json` exists
- `.review-loop/runs/<timestamp>/state.json` records both session ids once the agents connect
- `.review-loop/runs/<timestamp>/reviewer-session.json` and `fixer-session.json` exist
- `.review-loop/runs/<timestamp>/transcripts/reviewer.ndjson` and `fixer.ndjson` exist

- [ ] **Step 8: Commit**

```bash
git add scripts/review-loop/loop-controller.ts scripts/review-loop/summary.ts scripts/review-loop/cli.ts tests/review-loop/loop-controller.test.ts tests/review-loop/fake-agent-integration.test.ts
git commit -m "feat(scripts): automate ACP review loop"
```
