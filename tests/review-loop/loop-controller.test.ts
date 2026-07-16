// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import { createIssueLedger, IssueLedgerSnapshotSchema } from '../../review-loop/src/issue-ledger.js'
import type { IssueMatch, ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { runReviewLoop } from '../../review-loop/src/loop-controller.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'
import { execGit } from '../../review-loop/src/worktree.js'
import {
  cleanupTempDirs,
  createReviewLoopConfigFixture,
  makeTempDir,
  silentReporter,
  silentTrace,
} from './test-helpers.js'

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

function createMockSpawn(handlers: {
  reviewerIssues?: ReviewerIssue[][]
  fixerResults?: Array<{ verdict: string; fixability: string; fixed: boolean }>
  onFixer?: (cwd: string, callIndex: number) => Promise<void> | void
  matchExisting?: boolean
}): SpawnFn {
  let reviewerCall = 0
  let fixerCall = 0
  return async (_command: string, args: readonly string[], opts: { cwd: string }): Promise<SpawnResult> => {
    const promptText = args[args.length - 1] ?? ''
    const outputPath = extractOutputPath(promptText)

    if (promptText.includes('Review the current implementation')) {
      const issues = handlers.reviewerIssues?.[reviewerCall] ?? []
      reviewerCall += 1
      if (outputPath !== null) {
        writeFileSync(path.join(opts.cwd, outputPath), JSON.stringify({ issues }))
      }
    } else if (promptText.includes('Verify and fix') || promptText.includes('build error')) {
      const result = handlers.fixerResults?.[fixerCall] ?? { verdict: 'valid', fixability: 'auto', fixed: true }
      fixerCall += 1
      if (outputPath !== null) {
        writeFileSync(
          path.join(opts.cwd, outputPath),
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
      const matches = handlers.matchExisting === true ? matchAllToFirstExisting(promptText) : []
      if (outputPath !== null) {
        writeFileSync(path.join(opts.cwd, outputPath), JSON.stringify({ matches }))
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

function createMockExec(passed: boolean): ShellExecFn {
  return (): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
    Promise.resolve({
      exitCode: passed ? 0 : 1,
      stdout: '',
      stderr: passed ? '' : 'build error',
    })
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
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
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
      }),
      exec: (): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        const r = execResults[execIndex]!
        execIndex += 1
        return Promise.resolve(r)
      },
      log: silentReporter(),
      trace: silentTrace(),
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
      exec: (): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        const r = execResults[execIndex]!
        execIndex += 1
        return Promise.resolve(r)
      },
      log: silentReporter(),
      trace: silentTrace(),
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
      exec: (): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        const r = execResults[execIndex]!
        execIndex += 1
        return Promise.resolve(r)
      },
      log: silentReporter(),
      trace: silentTrace(),
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
    })

    const records = Object.values(ledger.snapshot.issues)
    expect(records.length).toBe(1)
    expect(records[0]!.status).toBe('rejected')
    expect(fixerCalls).toBe(1)
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

    const fixerActions: Array<() => Promise<void>> = [
      () => Promise.resolve(),
      () => {
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
        onFixer: (_cwd, callIndex) => fixerActions[callIndex]!(),
      }),
      exec: createMockExec(true),
      log: silentReporter(),
      trace: silentTrace(),
    })

    const onDisk = IssueLedgerSnapshotSchema.parse(JSON.parse(ledgerOnDiskAtSecondIssue))
    const records = Object.values(onDisk.issues)
    expect(records.length).toBe(2)
    const firstRecord = records.find((r) => r.issue.title === issue.title)
    expect(firstRecord).toBeDefined()
    expect(firstRecord!.status).toBe('fixed_pending_review')
    expect(firstRecord!.fixAttempts).toBe(1)
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
})
