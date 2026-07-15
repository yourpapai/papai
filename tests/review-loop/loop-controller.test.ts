// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import { createIssueLedger } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { runReviewLoop } from '../../review-loop/src/loop-controller.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { execGit } from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir, silentReporter } from './test-helpers.js'

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

function createMockSpawn(handlers: {
  reviewerIssues?: ReviewerIssue[][]
  fixerResults?: Array<{ verdict: string; fixability: string; fixed: boolean }>
}): SpawnFn {
  let reviewerCall = 0
  let fixerCall = 0
  return (_command: string, args: readonly string[], _opts: { cwd: string }): Promise<SpawnResult> => {
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
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
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
      log: silentReporter(),
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
    })

    expect(result.doneReason).toBe('clean')
    expect(execIndex).toBe(2)
  })
})
