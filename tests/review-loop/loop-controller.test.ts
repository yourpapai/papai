// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import { createIssueLedger, IssueLedgerSnapshotSchema } from '../../review-loop/src/issue-ledger.js'
import type { IssueMatch, ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { runReviewLoop } from '../../review-loop/src/loop-controller.js'
import { createRunState, PersistedRunStateSchema } from '../../review-loop/src/run-state.js'
import type { StopController, StopReason } from '../../review-loop/src/stop-controller.js'
import type { Decisions } from '../../review-loop/src/trace-log.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import { execGit } from '../../review-loop/src/worktree.js'
import {
  cleanupTempDirs,
  createReviewLoopConfigFixture,
  fakePool,
  makeTempDir,
  silentReporter,
  silentTrace,
} from './test-helpers.js'

function sumDecisions(d: Decisions): number {
  return d.fixed + d.invalid + d.already_fixed + d.needs_human + d.plan_drift + d.no_commit + d.inspector_rejected
}

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
  const match = prompt.match(/(?:to|JSON to):\s*(\S+)/u)
  return match?.[1] ?? null
}

function parseExistingIds(prompt: string): string[] {
  const section = prompt.split('Existing issues:')[1] ?? ''
  const ids: string[] = []
  for (const line of section.split('\n')) {
    const matched = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):/u.exec(line)
    if (matched) {
      ids.push(matched[1]!)
    }
  }
  return ids
}

function matchAllToFirstExisting(prompt: string): IssueMatch[] {
  const newSection = prompt.split('New issues:')[1]?.split('Existing issues:')[0] ?? ''
  const newCount = (newSection.match(/^\[\d+\]/gmu) ?? []).length
  const existingId = parseExistingIds(prompt)[0] ?? null
  return Array.from({ length: newCount }, (_, index) => ({ newIssueIndex: index, existingId }))
}

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

function matchExistingByFile(prompt: string): IssueMatch[] {
  const newSection = prompt.split('New issues:')[1]?.split('Existing issues:')[0] ?? ''
  const existingSection = prompt.split('Existing issues:')[1] ?? ''
  const fileToId = new Map<string, string>()
  for (const line of existingSection.split('\n')) {
    const matched = new RegExp(`^(${UUID_PATTERN}):\\s*(\\S+):`, 'u').exec(line)
    if (matched) {
      fileToId.set(matched[2]!, matched[1]!)
    }
  }
  const matches: IssueMatch[] = []
  for (const line of newSection.split('\n')) {
    const matched = /^\[(\d+)\]\s*(\S+):/u.exec(line)
    if (matched) {
      matches.push({ newIssueIndex: Number(matched[1]), existingId: fileToId.get(matched[2]!) ?? null })
    }
  }
  return matches
}

function createMockSpawn(handlers: {
  reviewerIssues?: ReviewerIssue[][]
  fixerResults?: Array<{ verdict: string; fixability: string; fixed: boolean; commitMessage?: string }>
  inspectorAddresses?: boolean
  onFixer?: (cwd: string, callIndex: number) => Promise<void> | void
  onReviewer?: (cwd: string, callIndex: number) => Promise<void> | void
  matchExisting?: boolean
  matchByFile?: boolean
  onMatch?: (prompt: string) => void
}): SpawnFn {
  let reviewerCall = 0
  let fixerCall = 0
  return async (_command: string, args: readonly string[], opts: { cwd: string }): Promise<SpawnResult> => {
    const promptText = args[args.length - 1] ?? ''
    const outputPath = extractOutputPath(promptText)
    const scratchPath = outputPath === null ? null : path.resolve(opts.cwd, outputPath)

    if (promptText.includes('Review the current implementation')) {
      const issues = handlers.reviewerIssues?.[reviewerCall] ?? []
      reviewerCall += 1
      if (scratchPath !== null) {
        mkdirSync(path.dirname(scratchPath), { recursive: true })
        writeFileSync(scratchPath, JSON.stringify({ issues }))
      }
      if (handlers.onReviewer) {
        await handlers.onReviewer(opts.cwd, reviewerCall - 1)
      }
    } else if (promptText.includes('You are an inspector')) {
      if (scratchPath !== null) {
        mkdirSync(path.dirname(scratchPath), { recursive: true })
        writeFileSync(
          scratchPath,
          JSON.stringify({
            addresses: handlers.inspectorAddresses ?? true,
            reasoning: 'Mock inspector acceptance.',
            confidence: 0.9,
          }),
        )
      }
    } else if (promptText.includes('Verify and fix') || promptText.includes('build error')) {
      const result = handlers.fixerResults?.[fixerCall] ?? { verdict: 'valid', fixability: 'auto', fixed: true }
      fixerCall += 1
      if (scratchPath !== null) {
        mkdirSync(path.dirname(scratchPath), { recursive: true })
        writeFileSync(
          scratchPath,
          JSON.stringify({
            ...result,
            reasoning: 'Fixed.',
            targetFiles: [],
            commitSha: result.fixed ? 'abc123' : null,
          }),
        )
      }
      if (handlers.onFixer) {
        await handlers.onFixer(opts.cwd, fixerCall - 1)
      }
    } else if (promptText.includes('Match newly found')) {
      const matches =
        handlers.matchByFile === true
          ? matchExistingByFile(promptText)
          : handlers.matchExisting === true
            ? matchAllToFirstExisting(promptText)
            : []
      if (scratchPath !== null) {
        mkdirSync(path.dirname(scratchPath), { recursive: true })
        writeFileSync(scratchPath, JSON.stringify({ matches }))
      }
      if (handlers.onMatch) {
        handlers.onMatch(promptText)
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

function createMockExec(passed: boolean): ShellExecFn {
  return (_cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
    Promise.resolve({
      exitCode: passed ? 0 : 1,
      stdout: '',
      stderr: passed ? '' : 'build error',
    })
}

interface AgentTimeouts {
  reviewer: Array<number | undefined>
  matcher: Array<number | undefined>
  fixer: Array<number | undefined>
  inspector: Array<number | undefined>
}

function createTimeoutRecordingSpawn(base: SpawnFn): { spawn: SpawnFn; timeouts: AgentTimeouts } {
  const timeouts: AgentTimeouts = { reviewer: [], matcher: [], fixer: [], inspector: [] }
  const spawn: SpawnFn = (command, args, opts) => {
    const promptText = args[args.length - 1] ?? ''
    if (promptText.includes('Review the current implementation')) {
      timeouts.reviewer.push(opts.timeout)
    } else if (promptText.includes('Match newly found')) {
      timeouts.matcher.push(opts.timeout)
    } else if (promptText.includes('You are an inspector')) {
      timeouts.inspector.push(opts.timeout)
    } else {
      timeouts.fixer.push(opts.timeout)
    }
    return base(command, args, opts)
  }
  return { spawn, timeouts }
}

async function setupGitRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  await execGit(repoPath, ['init'])
  await execGit(repoPath, ['config', 'user.email', 'test@test.com'])
  await execGit(repoPath, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(repoPath, '.gitignore'), '.review-loop/\n')
  writeFileSync(path.join(repoPath, 'README.md'), 'hello')
  await execGit(repoPath, ['add', '.'])
  await execGit(repoPath, ['commit', '-m', 'init'])
}

async function setupBareGitRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  await execGit(repoPath, ['init'])
  await execGit(repoPath, ['config', 'user.email', 'test@test.com'])
  await execGit(repoPath, ['config', 'user.name', 'Test'])
  writeFileSync(path.join(repoPath, 'README.md'), 'hello')
  await execGit(repoPath, ['add', '.'])
  await execGit(repoPath, ['commit', '-m', 'init'])
}

describe('runReviewLoop', () => {
  test('passes per-agent timeout overrides to reviewer, matcher, and fixer spawns', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, {
      agentTimeoutMs: 600_000,
      reviewer: { model: 'm1', extraArgs: [], timeoutMs: 111_000 },
      fixer: { model: 'm2', extraArgs: [], timeoutMs: 333_000 },
      matcher: { model: 'm3', extraArgs: [], timeoutMs: 222_000 },
    })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    const base = createMockSpawn({
      reviewerIssues: [[issue], [issue]],
      fixerResults: [
        { verdict: 'valid', fixability: 'auto', fixed: true },
        { verdict: 'valid', fixability: 'auto', fixed: true },
      ],
      onFixer: (cwd) => {
        writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
        return Promise.resolve()
      },
    })
    const { spawn, timeouts } = createTimeoutRecordingSpawn(base)

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn,
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    expect(result.doneReason).toBe('clean')
    expect(timeouts.reviewer).toEqual([111_000, 111_000, 111_000])
    expect(timeouts.matcher).toEqual([222_000])
    expect(timeouts.fixer).toEqual([333_000, 333_000])
    expect(timeouts.inspector).toEqual([333_000, 333_000])
  })

  test('falls back to agentTimeoutMs when no per-agent override is set', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { agentTimeoutMs: 600_000 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    const timeouts: Array<number | undefined> = []
    const base = createMockSpawn({ reviewerIssues: [[]] })
    const spawn: SpawnFn = (command, args, opts) => {
      timeouts.push(opts.timeout)
      return base(command, args, opts)
    }

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn,
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    expect(result.doneReason).toBe('clean')
    expect(timeouts).toEqual([600_000])
  })

  test('runs until reviewer reports no issues', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
          return Promise.resolve()
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
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

    await setupGitRepo(runState.worktreePath)

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], [issue]],
        fixerResults: [{ verdict: 'needs_human', fixability: 'manual', fixed: false }],
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
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

    await setupGitRepo(runState.worktreePath)

    const execResults: Array<{ exitCode: number; stdout: string; stderr: string }> = [
      { exitCode: 1, stdout: '', stderr: 'TypeError: broken' },
      { exitCode: 0, stdout: '', stderr: '' },
    ]
    let execIndex = 0

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
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
          return Promise.resolve()
        },
      }),
      exec: (_cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        const r = execResults[execIndex]!
        execIndex += 1
        return Promise.resolve(r)
      },
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    expect(result.doneReason).toBe('clean')
    expect(execIndex).toBe(2)
  })

  test('commits retry fixer changes when first fixer already committed', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    const execResults: Array<{ exitCode: number; stdout: string; stderr: string }> = [
      { exitCode: 1, stdout: '', stderr: 'TypeError: broken' },
      { exitCode: 0, stdout: '', stderr: '' },
    ]
    let execIndex = 0

    const fixerActions: Array<(cwd: string) => Promise<void>> = [
      async (cwd) => {
        writeFileSync(path.join(cwd, 'fix-0.txt'), 'first attempt\n')
        await execGit(cwd, ['add', '.'])
        await execGit(cwd, ['commit', '-m', 'fix attempt 0'])
      },
      (cwd) => {
        writeFileSync(path.join(cwd, 'fix-1.txt'), 'retry correction\n')
        return Promise.resolve()
      },
    ]

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
        onFixer: (cwd, callIndex) => fixerActions[callIndex]!(cwd),
      }),
      exec: (_cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        const r = execResults[execIndex]!
        execIndex += 1
        return Promise.resolve(r)
      },
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    expect(result.doneReason).toBe('clean')
    expect(execIndex).toBe(2)
    const status = (await execGit(runState.worktreePath, ['status', '--porcelain'])).stdout.trim()
    expect(status).toBe('')
    const committed = (await execGit(runState.worktreePath, ['show', 'HEAD:fix-1.txt'])).stdout
    expect(committed).toContain('retry correction')
  })

  test('resets worktree to baseline SHA when retry build also fails', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

    const commitOnFix = async (cwd: string, callIndex: number): Promise<void> => {
      writeFileSync(path.join(cwd, `fix-${callIndex}.txt`), `attempt ${callIndex}`)
      await execGit(cwd, ['add', '.'])
      await execGit(cwd, ['commit', '-m', `fix attempt ${callIndex}`])
    }

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], [issue]],
        fixerResults: [
          { verdict: 'valid', fixability: 'auto', fixed: true },
          { verdict: 'valid', fixability: 'auto', fixed: true },
        ],
        onFixer: commitOnFix,
      }),
      exec: createMockExec(false),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    expect(result.doneReason).toBe('no_progress')
    const headAfter = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    expect(headAfter).toBe(baselineSha)
  })

  test('does not mark fixed when retry agent reports not fixed even if build would pass', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 1, maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    const execResults: Array<{ exitCode: number; stdout: string; stderr: string }> = [
      { exitCode: 1, stdout: '', stderr: 'TypeError: broken' },
      { exitCode: 0, stdout: '', stderr: '' },
    ]
    let execIndex = 0

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue]],
        fixerResults: [
          { verdict: 'valid', fixability: 'auto', fixed: true },
          { verdict: 'needs_human', fixability: 'manual', fixed: false },
        ],
      }),
      exec: (_cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        const r = execResults[execIndex]!
        execIndex += 1
        return Promise.resolve(r)
      },
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const records = Object.values(ledger.snapshot.issues)
    expect(records.length).toBe(1)
    expect(records[0]!.status).toBe('needs_human')
    expect(execIndex).toBe(1)
  })

  test('reverts partial fixer edits when fixer reports not fixed', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 1, maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue]],
        fixerResults: [{ verdict: 'needs_human', fixability: 'manual', fixed: false }],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'README.md'), 'corrupted by partial fix\n')
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const headAfter = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    expect(headAfter).toBe(baselineSha)
    const status = (await execGit(runState.worktreePath, ['status', '--porcelain'])).stdout.trim()
    expect(status).toBe('')
    const readme = readFileSync(path.join(runState.worktreePath, 'README.md'), 'utf8')
    expect(readme).toBe('hello')
  })

  test('auto-commits uncommitted fixer changes to prevent silent loss on merge', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'export const fixed = true\n')
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    expect(result.doneReason).toBe('clean')
    const headAfter = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    expect(headAfter).not.toBe(baselineSha)
    const status = (await execGit(runState.worktreePath, ['status', '--porcelain'])).stdout.trim()
    expect(status).toBe('')
    const committed = (await execGit(runState.worktreePath, ['show', 'HEAD:fixed.ts'])).stdout
    expect(committed).toContain('export const fixed = true')
  })

  test('does not commit agent scratch files when .review-loop is not gitignored', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupBareGitRepo(runState.worktreePath)

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'export const fixed = true\n')
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const committedFiles = (
      await execGit(runState.worktreePath, ['show', 'HEAD', '--name-only', '--pretty=format:'])
    ).stdout
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0)

    expect(committedFiles).toContain('fixed.ts')
    expect(committedFiles.some((f) => f.startsWith('.review-loop/'))).toBe(false)
  })

  test('does not re-discover terminal issues as duplicates across rounds', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 2, maxNoProgressRounds: 2 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    let fixerCalls = 0
    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], [issue]],
        fixerResults: [
          { verdict: 'invalid', fixability: 'manual', fixed: false },
          { verdict: 'invalid', fixability: 'manual', fixed: false },
        ],
        matchExisting: true,
        onFixer: () => {
          fixerCalls += 1
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const records = Object.values(ledger.snapshot.issues)
    expect(records.length).toBe(1)
    expect(records[0]!.status).toBe('rejected')
    expect(fixerCalls).toBe(1)
  })

  test('drops stale terminal records from matcher context so a re-report becomes a new ledger entry', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 4, maxNoProgressRounds: 5 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    const fillerIssue: ReviewerIssue = {
      ...issue,
      title: 'Unrelated typo in readme',
      evidence: 'README.md line 1',
      file: 'README.md',
    }

    const matcherPrompts: string[] = []

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], [fillerIssue], [fillerIssue], [issue]],
        fixerResults: [
          { verdict: 'invalid', fixability: 'manual', fixed: false },
          { verdict: 'invalid', fixability: 'manual', fixed: false },
          { verdict: 'invalid', fixability: 'manual', fixed: false },
        ],
        matchByFile: true,
        onMatch: (prompt) => {
          matcherPrompts.push(prompt)
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    expect(matcherPrompts).toHaveLength(3)
    const rejectedId = parseExistingIds(matcherPrompts[0]!)[0]!
    expect(parseExistingIds(matcherPrompts[0]!)).toContain(rejectedId)
    expect(parseExistingIds(matcherPrompts[2]!)).not.toContain(rejectedId)

    const sameTitle = Object.values(ledger.snapshot.issues).filter((r) => r.issue.title === issue.title)
    expect(sameTitle).toHaveLength(2)
    expect(sameTitle.some((r) => r.firstSeenRound === 1)).toBe(true)
    expect(sameTitle.some((r) => r.firstSeenRound === 4)).toBe(true)
  })

  test('persists ledger after each issue so mid-round crash does not lose state', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    const issue2: ReviewerIssue = {
      ...issue,
      title: 'Second issue',
      evidence: 'src/foo.ts lines 1-10',
      file: 'src/foo.ts',
    }

    let ledgerOnDiskAtSecondIssue = ''

    const fixerActions: Array<(cwd: string) => Promise<void>> = [
      (cwd) => {
        writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
        return Promise.resolve()
      },
      (cwd) => {
        writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
        ledgerOnDiskAtSecondIssue = readFileSync(ledger.path, 'utf8')
        return Promise.resolve()
      },
    ]

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue, issue2], []],
        fixerResults: [
          { verdict: 'valid', fixability: 'auto', fixed: true },
          { verdict: 'valid', fixability: 'auto', fixed: true },
        ],
        onFixer: (cwd, callIndex) => fixerActions[callIndex]!(cwd),
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const onDisk = IssueLedgerSnapshotSchema.parse(JSON.parse(ledgerOnDiskAtSecondIssue))
    const records = Object.values(onDisk.issues)
    expect(records.length).toBe(2)
    const firstRecord = records.find((r) => r.issue.title === issue.title)
    expect(firstRecord).toBeDefined()
    expect(firstRecord!.status).toBe('fixed_pending_review')
    expect(firstRecord!.fixAttempts).toBe(1)
  })

  test('persists currentRound to state.json at round entry so mid-round crash reports the right round', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    await setupGitRepo(runState.worktreePath)

    const stateSnapshots: string[] = []
    const spawn = createMockSpawn({
      reviewerIssues: [[issue], []],
      fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
      onReviewer: () => {
        stateSnapshots.push(readFileSync(runState.statePath, 'utf8'))
      },
    })

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn,
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    expect(stateSnapshots.length).toBeGreaterThanOrEqual(1)
    const firstSnapshot = PersistedRunStateSchema.parse(JSON.parse(stateSnapshots[0]!))
    expect(firstSnapshot.currentRound).toBe(1)
  })

  test('emits trace events and returns per-round metrics', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    const { logger, events } = createCapturingTraceLogger()

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'x\n')
          return Promise.resolve()
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: logger,
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const types = events.map((e) => e.event)
    expect(types).toContain('round_start')
    expect(types).toContain('review_complete')
    expect(types).toContain('round_summary')
    expect(types).toContain('loop_end')
    expect(result.metrics).toBeDefined()
    expect(result.metrics!.map((m) => m.round)).toEqual([1, 2])
    const r1 = result.metrics![0]!
    expect(r1.newIssues).toBe(1)
    expect(r1.reviewerSeverity.high).toBe(1)
  })

  test('does not mark fixed when fixer claims fixed but commits nothing (no-commit guard)', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    const { logger, events } = createCapturingTraceLogger()

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: logger,
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const records = Object.values(ledger.snapshot.issues)
    expect(records).toHaveLength(1)
    expect(records[0]!.fixAttempts).toBe(0)
    expect(records[0]!.status).not.toBe('fixed_pending_review')
    const fixCompletes = events.filter((e) => e.event === 'fix_complete')
    expect(fixCompletes.some((e) => !e.fixed)).toBe(true)
    expect(result.metrics).toBeDefined()
  })

  test('uses sanitized fixer commitMessage as the commit subject', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [
          { verdict: 'valid', fixability: 'auto', fixed: true, commitMessage: 'fix(review-loop): real change' },
        ],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
          return Promise.resolve()
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const subject = (await execGit(runState.worktreePath, ['log', '-1', '--format=%s'])).stdout.trim()
    expect(subject).toBe('fix(review-loop): real change')
  })

  test('falls back to issue-title commit subject when fixer omits commitMessage', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
          return Promise.resolve()
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const subject = (await execGit(runState.worktreePath, ['log', '-1', '--format=%s'])).stdout.trim()
    expect(subject).toBe(`fix(review-loop): ${issue.title}`)
  })

  test('falls back to issue-title subject when commitMessage sanitizes to empty', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true, commitMessage: '``````' }],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
          return Promise.resolve()
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const headAfter = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
    expect(headAfter).not.toBe(baselineSha)
    const subject = (await execGit(runState.worktreePath, ['log', '-1', '--format=%s'])).stdout.trim()
    expect(subject.length).toBeGreaterThan(0)
    expect(subject).toBe(`fix(review-loop): ${issue.title}`)
  })

  test('clean -fd removes untracked scratch files on not-fixed revert', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 1, maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue]],
        fixerResults: [{ verdict: 'needs_human', fixability: 'manual', fixed: false }],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'scratch.txt'), 'junk\n')
          return Promise.resolve()
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const status = (await execGit(runState.worktreePath, ['status', '--porcelain'])).stdout.trim()
    expect(status).toBe('')
    expect(existsSync(path.join(runState.worktreePath, 'scratch.txt'))).toBe(false)
  })

  test('counts a retried-then-succeeded issue as a single fixed decision', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 1, maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    const execResults: Array<{ exitCode: number; stdout: string; stderr: string }> = [
      { exitCode: 1, stdout: '', stderr: 'TypeError: broken' },
      { exitCode: 0, stdout: '', stderr: '' },
    ]
    let execIndex = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue]],
        fixerResults: [
          { verdict: 'valid', fixability: 'auto', fixed: true },
          { verdict: 'valid', fixability: 'auto', fixed: true },
        ],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
          return Promise.resolve()
        },
      }),
      exec: (_cwd?: string): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        const r = execResults[execIndex]!
        execIndex += 1
        return Promise.resolve(r)
      },
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const decisions = result.metrics![0]!.decisions
    expect(decisions.fixed).toBe(1)
    expect(sumDecisions(decisions)).toBe(1)
  })

  test('does not double-tally an issue that fails build then fails again on retry', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 1, maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue]],
        fixerResults: [
          { verdict: 'valid', fixability: 'auto', fixed: true },
          { verdict: 'valid', fixability: 'auto', fixed: true },
        ],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
          return Promise.resolve()
        },
      }),
      exec: createMockExec(false),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
    })

    const decisions = result.metrics![0]!.decisions
    expect(decisions.needs_human).toBe(1)
    expect(decisions.fixed).toBe(0)
    expect(sumDecisions(decisions)).toBe(1)
  })
})

/** A stop nothing arms on its own, so a test decides exactly when the run is over. */
function manualStop(): StopController {
  let reason: StopReason | null = null
  return {
    requested: () => reason,
    request: (next) => {
      reason ??= next
    },
    dispose: () => undefined,
  }
}

describe('runReviewLoop under a stop request', () => {
  test('finishes the round it is in and starts no further one', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 5 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    const stop = manualStop()
    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        // Enough rounds' worth of findings that only the stop can end this run.
        reviewerIssues: [[issue], [issue], [issue]],
        fixerResults: [
          { verdict: 'valid', fixability: 'auto', fixed: true },
          { verdict: 'valid', fixability: 'auto', fixed: true },
        ],
        onFixer: (cwd) => {
          writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n')
          stop.request('budget')
          return Promise.resolve()
        },
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
      stop,
    })

    expect(result.doneReason).toBe('stopped')
    expect(result.rounds).toBe(1)
    // The round it was in still counts: its fix was accepted, built and merged.
    expect(result.metrics?.[0]?.decisions.fixed).toBe(1)
  })

  test('starts no round at all when the stop is already asked for', async () => {
    const repoRoot = makeTempDir('loop-ctrl-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupGitRepo(runState.worktreePath)

    let spawns = 0
    const stop = manualStop()
    stop.request('signal')

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: (command, args, opts) => {
        spawns += 1
        return createMockSpawn({ reviewerIssues: [[]] })(command, args, opts)
      },
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
      pool: fakePool({ size: 1, worktreePath: runState.worktreePath }).pool,
      inspect: true,
      stop,
    })

    expect(result.doneReason).toBe('stopped')
    expect(spawns).toBe(0)
  })
})
