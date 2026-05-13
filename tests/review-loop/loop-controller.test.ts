import { afterEach, describe, expect, test } from 'bun:test'
import path from 'node:path'

import { createIssueLedger } from '../../review-loop/src/issue-ledger.js'
import { runReviewLoop } from '../../review-loop/src/loop-controller.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir } from './test-helpers.js'

function createSilentLog(): { log: (message: string) => void; messages: string[] } {
  const messages: string[] = []
  return {
    log: (message: string): void => {
      messages.push(message)
    },
    messages,
  }
}

function reviewerThatFindsRaceCondition(): () => Promise<{
  text: string
  stopReason: string
}> {
  let reviewerPromptCount = 0
  return () =>
    Promise.resolve({
      text: JSON.stringify({
        round: (reviewerPromptCount += 1),
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
      stopReason: 'end_turn',
    })
}

afterEach(cleanupTempDirs)

describe('runReviewLoop', () => {
  test('runs until the reviewer reports no issues', async () => {
    const repoRoot = makeTempDir('review-loop-controller-')
    const config = createReviewLoopConfigFixture(repoRoot)

    const planPath = path.join(repoRoot, 'plan.md')
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
        needsPlanning: false,
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
        promptText: () => {
          const reply = reviewerReplies[reviewerIndex++]
          expect(reply).toBeDefined()
          return Promise.resolve({ text: reply!, stopReason: 'end_turn' })
        },
      },
      fixer: {
        availableCommands: ['verify-issue'],
        promptText: () => {
          const reply = fixerReplies[fixerIndex++]
          expect(reply).toBeDefined()
          return Promise.resolve({ text: reply!, stopReason: 'end_turn' })
        },
      },
      log: createSilentLog(),
    })

    expect(result.doneReason).toBe('clean')
    expect(result.rounds).toBe(1)
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'closed')).toBe(true)
  })

  test('uses configured invocation prefixes for review, verify, fix, and rereview prompts', async () => {
    const repoRoot = makeTempDir('review-loop-controller-')
    const config = createReviewLoopConfigFixture(repoRoot, {
      reviewer: {
        command: '/usr/local/bin/claude-acp-adapter',
        args: [],
        env: {},
        sessionConfig: {},
        invocationPrefix: '/review-code',
        requireInvocationPrefix: true,
      },
      fixer: {
        command: 'opencode',
        args: ['acp'],
        env: {},
        sessionConfig: {},
        verifyInvocationPrefix: '/verify-issue',
        fixInvocationPrefix: '/fix-issue',
        requireVerifyInvocation: true,
      },
    })

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const reviewerPrompts: string[] = []
    const fixerPrompts: string[] = []
    const reviewerReplyTexts = [
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
    let reviewerReplyIndex = 0
    const fixerReplyTexts = [
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'The control flow is actually unsafe.',
        targetFiles: ['src/message-queue/queue.ts'],
        needsPlanning: false,
      }),
      'Applied the minimal fix and ran the targeted test.',
    ]
    let fixerReplyIndex = 0

    await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: (text) => {
          reviewerPrompts.push(text)
          const reply = reviewerReplyTexts[reviewerReplyIndex++]
          expect(reply).toBeDefined()
          return Promise.resolve({ text: reply!, stopReason: 'end_turn' })
        },
      },
      fixer: {
        availableCommands: ['verify-issue', 'fix-issue'],
        promptText: (text) => {
          fixerPrompts.push(text)
          const reply = fixerReplyTexts[fixerReplyIndex++]
          expect(reply).toBeDefined()
          return Promise.resolve({ text: reply!, stopReason: 'end_turn' })
        },
      },
      log: createSilentLog(),
    })

    expect(reviewerPrompts).toHaveLength(2)
    expect(fixerPrompts).toHaveLength(2)
    expect(reviewerPrompts[0]?.startsWith('/review-code ')).toBe(true)
    expect(reviewerPrompts[1]?.startsWith('/review-code ')).toBe(true)
    expect(fixerPrompts[0]?.startsWith('/verify-issue ')).toBe(true)
    expect(fixerPrompts[1]?.startsWith('/fix-issue ')).toBe(true)
  })

  test('stops with no_progress when a round produces no auto-fixable progress', async () => {
    const repoRoot = makeTempDir('review-loop-controller-')
    const config = createReviewLoopConfigFixture(repoRoot, {
      maxNoProgressRounds: 1,
      fixer: {
        command: 'opencode',
        args: ['acp'],
        env: {},
        sessionConfig: {},
        verifyInvocationPrefix: '/verify-issue',
        fixInvocationPrefix: '/fix-issue',
        requireVerifyInvocation: false,
      },
    })

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: reviewerThatFindsRaceCondition(),
      },
      fixer: {
        availableCommands: ['verify-issue', 'fix-issue'],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
              verdict: 'needs_human',
              fixability: 'manual',
              reasoning: 'This needs a product decision.',
              targetFiles: ['src/message-queue/queue.ts'],
              needsPlanning: false,
            }),
            stopReason: 'end_turn',
          }),
      },
      log: createSilentLog(),
    })

    expect(result.doneReason).toBe('no_progress')
    expect(result.rounds).toBe(1)
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'needs_human')).toBe(true)
  })

  test('does not re-verify issues already in a terminal status across rounds', async () => {
    const repoRoot = makeTempDir('review-loop-controller-')
    const config = createReviewLoopConfigFixture(repoRoot)

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    let verifyCallCount = 0

    // Reviewer always re-raises the same issue every round (and re-review)
    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
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
            stopReason: 'end_turn',
          }),
      },
      fixer: {
        availableCommands: ['verify-issue'],
        promptText: () => {
          verifyCallCount += 1
          return Promise.resolve({
            text: JSON.stringify({
              verdict: 'invalid',
              fixability: 'manual',
              reasoning: 'False positive — the lock is already taken upstream.',
              targetFiles: ['src/message-queue/queue.ts'],
              needsPlanning: false,
            }),
            stopReason: 'end_turn',
          })
        },
      },
      log: createSilentLog(),
    })

    // The issue was rejected in round 1. The reviewer raises it again in round 2,
    // but the verifier must NOT be called again for an already-rejected issue.
    expect(verifyCallCount).toBe(1)
    expect(result.doneReason).toBe('no_progress')
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'rejected')).toBe(true)
  })

  test('plans before fixing when verifier sets needsPlanning to true', async () => {
    const repoRoot = makeTempDir('review-loop-controller-')
    const config = createReviewLoopConfigFixture(repoRoot, {
      reviewer: {
        command: 'opencode',
        args: ['acp'],
        env: {},
        sessionConfig: {},
        invocationPrefix: null,
        requireInvocationPrefix: false,
      },
      fixer: {
        command: '/usr/local/bin/claude-acp-adapter',
        args: [],
        env: {},
        sessionConfig: {},
        verifyInvocationPrefix: null,
        fixInvocationPrefix: null,
        requireVerifyInvocation: false,
      },
    })

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    const fixerPrompts: string[] = []

    const reviewerReplyTexts = [
      JSON.stringify({
        round: 1,
        issues: [
          {
            title: 'Complex refactoring needed',
            severity: 'high',
            summary: 'Module boundary is wrong.',
            whyItMatters: 'Causes import cycles.',
            evidence: 'src/a.ts line 10',
            file: 'src/a.ts',
            lineStart: 10,
            lineEnd: 20,
            suggestedFix: 'Move interface to shared module.',
            confidence: 0.85,
          },
        ],
      }),
      JSON.stringify({ round: 2, issues: [] }),
    ]
    let reviewerReplyIndex = 0

    const fixerReplyTexts = [
      JSON.stringify({
        verdict: 'valid',
        fixability: 'auto',
        reasoning: 'Needs multi-file change.',
        targetFiles: ['src/a.ts', 'src/b.ts'],
        needsPlanning: true,
      }),
      'Step 1: Move interface. Step 2: Update imports.',
      'Applied the fix and committed.',
    ]
    let fixerReplyIndex = 0

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: [],
        promptText: () => {
          const reply = reviewerReplyTexts[reviewerReplyIndex++]
          expect(reply).toBeDefined()
          return Promise.resolve({ text: reply!, stopReason: 'end_turn' })
        },
      },
      fixer: {
        availableCommands: [],
        promptText: (text) => {
          fixerPrompts.push(text)
          const reply = fixerReplyTexts[fixerReplyIndex++]
          expect(reply).toBeDefined()
          return Promise.resolve({ text: reply!, stopReason: 'end_turn' })
        },
      },
      log: createSilentLog(),
    })

    expect(result.doneReason).toBe('clean')
    expect(fixerPrompts).toHaveLength(3)
    expect(fixerPrompts[1]).toContain('step-by-step plan')
    expect(fixerPrompts[2]).toContain('Fix Plan:')
    expect(fixerPrompts[2]).toContain('Step 1: Move interface')
  })

  test('stops with max_rounds when unresolved issues remain after the final round', async () => {
    const repoRoot = makeTempDir('review-loop-controller-')
    const config = createReviewLoopConfigFixture(repoRoot, {
      maxRounds: 1,
      fixer: {
        command: 'opencode',
        args: ['acp'],
        env: {},
        sessionConfig: {},
        verifyInvocationPrefix: '/verify-issue',
        fixInvocationPrefix: '/fix-issue',
        requireVerifyInvocation: false,
      },
    })

    const planPath = path.join(repoRoot, 'plan.md')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)

    const result = await runReviewLoop({
      config,
      runState,
      ledger,
      reviewer: {
        availableCommands: ['review-code'],
        promptText: reviewerThatFindsRaceCondition(),
      },
      fixer: {
        availableCommands: ['verify-issue', 'fix-issue'],
        promptText: () =>
          Promise.resolve({
            text: JSON.stringify({
              verdict: 'invalid',
              fixability: 'manual',
              reasoning: 'This is a false positive.',
              targetFiles: ['src/message-queue/queue.ts'],
              needsPlanning: false,
            }),
            stopReason: 'end_turn',
          }),
      },
      log: createSilentLog(),
    })

    expect(result.doneReason).toBe('max_rounds')
    expect(result.rounds).toBe(1)
    expect(Object.values(result.ledger.issues).every((record) => record.status === 'rejected')).toBe(true)
  })
})
