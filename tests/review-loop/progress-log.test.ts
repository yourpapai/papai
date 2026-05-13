import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ReviewLoopConfig } from '../../review-loop/src/config.js'
import { createIssueLedger } from '../../review-loop/src/issue-ledger.js'
import { runReviewLoop } from '../../review-loop/src/loop-controller.js'
import type { ProgressLog } from '../../review-loop/src/progress-log.js'
import { createRunState } from '../../review-loop/src/run-state.js'

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

    const log: ProgressLog = {
      log: (message) => {
        messages.push(message)
      },
    }

    const reviewerReplies = [
      JSON.stringify({
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
      }),
      JSON.stringify({ round: 2, issues: [] }),
    ]
    let reviewerReplyIndex = 0
    const fixerReplies = [
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'Confirmed.',
        targetFiles: ['src/foo.ts'],
        needsPlanning: false,
      }),
      'Fixed.',
    ]
    let fixerReplyIndex = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      log,
      reviewer: {
        availableCommands: [],
        promptText: () => {
          const reply = reviewerReplies[reviewerReplyIndex++]
          expect(reply).toBeDefined()
          return Promise.resolve({ text: reply!, stopReason: 'end_turn' })
        },
      },
      fixer: {
        availableCommands: [],
        promptText: () => {
          const reply = fixerReplies[fixerReplyIndex++]
          expect(reply).toBeDefined()
          return Promise.resolve({ text: reply!, stopReason: 'end_turn' })
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

    const log: ProgressLog = {
      log: (message) => {
        messages.push(message)
      },
    }

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      log,
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

    const log: ProgressLog = {
      log: (message) => {
        messages.push(message)
      },
    }

    await runReviewLoop({
      config,
      runState,
      ledger,
      log,
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
