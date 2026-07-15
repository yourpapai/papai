// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { ShellExecFn } from '../../review-loop/src/build-checker.js'
import { createIssueLedger } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { runReviewLoop } from '../../review-loop/src/loop-controller.js'
import type { ProgressLog } from '../../review-loop/src/progress-log.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const issue: ReviewerIssue = {
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

const passingExec: ShellExecFn = (): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
  Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })

function makeLog(messages: string[]): ProgressLog {
  return {
    log: (message: string): void => {
      messages.push(message)
    },
  }
}

describe('progress logging', () => {
  test('logs round start, issue discovery, verification, fix, and done for a clean round', async () => {
    const repoRoot = makeTempDir('review-loop-progress-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const messages: string[] = []

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[issue], []],
        fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
      }),
      exec: passingExec,
      log: makeLog(messages),
    })

    expect(result.doneReason).toBe('clean')
    expect(messages).toContain('[round 1/5] Reviewing...')
    expect(messages).toContain('[round 1] Found 1 issues')
    expect(messages.some((m) => m.startsWith('[fix] "Missing error handling"'))).toBe(true)
    expect(messages).toContain('[round 1] Fixed 1/1 issues')
    expect(messages).toContain('[done] clean after 2 rounds')
  })

  test('logs stall and no_progress when no issues are fixed', async () => {
    const repoRoot = makeTempDir('review-loop-progress-')
    const config = createReviewLoopConfigFixture(repoRoot, { maxNoProgressRounds: 1 })
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const messages: string[] = []

    const stallIssue: ReviewerIssue = {
      ...issue,
      title: 'Persistent issue',
      severity: 'medium',
    }

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[stallIssue], [stallIssue]],
        fixerResults: [{ verdict: 'needs_human', fixability: 'manual', fixed: false }],
      }),
      exec: passingExec,
      log: makeLog(messages),
    })

    expect(result.doneReason).toBe('no_progress')
    expect(messages).toContain('[done] no_progress')
  })

  test('truncates long issue titles in log output', async () => {
    const repoRoot = makeTempDir('review-loop-progress-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const messages: string[] = []

    const longTitle = 'A'.repeat(80)
    const longIssue: ReviewerIssue = { ...issue, title: longTitle, severity: 'low' }

    await runReviewLoop({
      config,
      runState,
      ledger,
      spawn: createMockSpawn({
        reviewerIssues: [[longIssue], []],
        fixerResults: [{ verdict: 'invalid', fixability: 'manual', fixed: false }],
      }),
      exec: passingExec,
      log: makeLog(messages),
    })

    const fixMessage = messages.find((m) => m.startsWith('[fix]'))
    expect(fixMessage).toBeDefined()
    expect(fixMessage!.length).toBeLessThan(longTitle.length + 40)
  })
})
