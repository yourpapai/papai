// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  appliedSchema,
  assessmentContext,
  assessmentRequest,
  applyRequest,
  FOLLOW_UP_APPLY_INSTRUCTIONS,
  FOLLOW_UP_FORBIDDEN_GIT_RULE,
  verdictSchema,
} from '../../opencode-agent/src/follow-up-prompts.js'
import type { MachineInput } from '../../opencode-agent/src/phase-context.js'
import { MINIMALITY_RULE } from '../../opencode-agent/src/prompts.js'
import { PROTECTED_PATHS_RULE } from '../../opencode-agent/src/protected-paths.js'
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * What the `/follow-up` handler says to the model, in its own right.
 *
 * `follow-up.test.ts` drives both turns end to end; this file pins the seams
 * the handler's tests only sample — the zod verdicts (a missing reason is
 * rejected, not defaulted), the request profiles (the gate cannot edit, the
 * apply turn builds), the context the gate reads (the folder's truth and the
 * branch's own diff, degrading honestly when the branch has none), and the two
 * rules the apply instructions must carry **verbatim**, asserted against the
 * constants so a softened copy fails here rather than passing quietly.
 */

const PR_STATE = (): AgentState => ({
  v: 3,
  phase: 'COMPLETE',
  issueId: 42,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  ciBlockedPaths: [],
  changedLines: 0,
  stepsDone: 0,
  changeName: 'add-retry-backoff',
  planRevision: 1,
  tokenScale: TOKEN_SCALE,
  tokensSpent: 0,
  usdSpent: 0,
  usdUnpriced: false,
  lastError: null,
  prUrl: 'https://example.test/pull/7',
  prNumber: 7,
})

const PR_INPUT = (): MachineInput => {
  const recording = stubPhaseDeps({ selfLogin: 'agent-bot' })
  // The stub driver resolves the proposal to this path; seeding it gives the
  // digest the folder's truth, the way a real checkout would.
  recording.io.readContents['/repo/x.md'] = 'Tighten the retry helper.'
  recording.deps.git.diffSince = (): Promise<string> => Promise.resolve(' src/http/retry.ts | 2 +-')
  return {
    state: PR_STATE(),
    issue: { number: 42, title: 't', body: 'b' },
    trigger: {
      kind: 'pull-request',
      eventName: 'issue_comment',
      action: 'created',
      senderLogin: 'maintainer',
      senderType: 'User',
      authorAssociation: 'OWNER',
      prNumber: 7,
      commentBody: '/follow-up tighten the backoff',
      commentId: 99,
      defaultBranch: 'main',
      issueNumber: 42,
    },
    command: { command: '/follow-up', argument: 'tighten the backoff' },
    thread: recording.io.thread,
    deps: recording.deps,
    answer: false,
    posted: false,
    carriedTokens: 0,
    carriedUsd: 0,
    carriedUnpriced: false,
    followUp: true,
  }
}

const ENVELOPE = {
  nonce: 'n-1',
  wrap: (label: string, body: string): string => `[${label}] ${body}`,
}

describe('the verdict and reply schemas', () => {
  it('accepts the two shapes the handler asks for', () => {
    expect(verdictSchema.safeParse({ size: 'small', reason: 'bounded' }).success).toBe(true)
    expect(verdictSchema.safeParse({ size: 'too-big', reason: 'a new capability' }).success).toBe(true)
    expect(appliedSchema.safeParse({ summary: 's', files: ['a.ts'], testCommands: ['bun test'] }).success).toBe(true)
  })

  it('rejects a verdict without a reason — the reason is mandatory on both paths', () => {
    expect(verdictSchema.safeParse({ size: 'small' }).success).toBe(false)
    expect(verdictSchema.safeParse({ size: 'huge', reason: 'x' }).success).toBe(false)
    expect(appliedSchema.safeParse({ summary: 's' }).success).toBe(false)
  })
})

describe('the request builders', () => {
  it('asks the size gate on the read-only plan profile', () => {
    const request = assessmentRequest('COMPLETE', '/repo', ENVELOPE, 'tighten the backoff', {
      base: 'main',
      changeDigest: 'Change `add-retry-backoff`',
      diffStat: ' src/retry.ts | 2 +-',
    })

    expect(request.agent).toBe('plan')
    // The request reaches the prompt only through the envelope.
    expect(request.prompt).toContain('[follow-up-request] tighten the backoff')
    expect(request.prompt).toContain('add-retry-backoff')
    expect(request.prompt).toContain('src/retry.ts')
  })

  it('asks the apply turn on the build profile, with the verdict and the forbidden-git rule', () => {
    const request = applyRequest(
      'COMPLETE',
      '/repo',
      ENVELOPE,
      'tighten the backoff',
      { base: 'main', changeDigest: 'Change `add-retry-backoff`', diffStat: ' src/retry.ts | 2 +-' },
      'A one-line constant change.',
    )

    expect(request.agent).toBe('build')
    expect(request.system).toContain(FOLLOW_UP_APPLY_INSTRUCTIONS)
    expect(request.prompt).toContain('A one-line constant change.')
    expect(request.prompt).toContain(FOLLOW_UP_FORBIDDEN_GIT_RULE)
  })
})

describe('FOLLOW_UP_APPLY_INSTRUCTIONS', () => {
  it('carries the pinned rules verbatim', () => {
    // Asserted against the constants, in the `instructions.test.ts` style: a
    // softened copy of either rule cannot pass here.
    expect(FOLLOW_UP_APPLY_INSTRUCTIONS).toContain(PROTECTED_PATHS_RULE)
    expect(FOLLOW_UP_APPLY_INSTRUCTIONS).toContain(MINIMALITY_RULE)
    expect(FOLLOW_UP_APPLY_INSTRUCTIONS).toContain(FOLLOW_UP_FORBIDDEN_GIT_RULE)
  })
})

describe('assessmentContext', () => {
  it('digests the change folder and the branch diff as facts the gate reads', async () => {
    const context = await assessmentContext(PR_INPUT(), 'main')

    // The folder's truth, by name, and the branch's own diff stat.
    expect(context.changeDigest).toContain('add-retry-backoff')
    expect(context.changeDigest).toContain('Tighten the retry helper.')
    expect(context.diffStat).toContain('src/http/retry.ts')
    expect(context.base).toBe('main')
  })

  it('degrades honestly when the branch carries no changes yet', async () => {
    const input = PR_INPUT()
    input.deps.git.diffSince = (): Promise<string> => Promise.resolve('')

    const context = await assessmentContext(input, 'main')

    expect(context.diffStat).toContain('no changes')
  })
})
