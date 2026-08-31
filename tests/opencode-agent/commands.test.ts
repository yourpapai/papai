// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  acceptedCommands,
  COMMAND_SIGNALS,
  parseSlashCommand,
  SLASH_COMMANDS,
} from '../../opencode-agent/src/commands.js'
import { renderRefusedCommand } from '../../opencode-agent/src/run-report.js'
import { PHASES, TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import type { AgentState, Phase } from '../../opencode-agent/src/types.js'

/**
 * `/sync` joins the vocabulary as the `/ask` shape: a non-moving side
 * operation, accepted wherever the agent branch exists and refused as a wrong
 * command everywhere else.
 *
 * What these tests pin is the one rule with two readers — the offer a refusal
 * lists and the gate that enforces it are both `COMMAND_APPLIES`, so they
 * cannot drift — plus the property that makes the whole command safe to accept
 * in any branch-bearing phase: it injects no signal, so the transition table is
 * never consulted and no park/resume question exists to answer.
 *
 * "The branch exists" is `changeName !== null` by the workspace's own doctrine
 * (a `changeName === null` state has no folder to read and no branch to switch
 * to), widened past `prNumber` after issue #323: the drift refusal parked the
 * issue FAILED with no pull request, named `/sync` as the remedy, and the gate
 * refused it — a remedy the state it was prescribed for could not take.
 */

const state = (phase: Phase, over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase,
  issueId: 42,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  ciBlockedPaths: [],
  changedLines: 0,
  stepsDone: 0,
  changeName: 'add-x',
  planRevision: 1,
  tokenScale: TOKEN_SCALE,
  tokensSpent: 0,
  usdSpent: 0,
  usdUnpriced: false,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

/** Every phase whose state may carry a delivered pull request. */
const PR_PHASES = ['COMPLETE', 'FAILED', 'INCOMPLETE', 'CODE_REVIEW', 'CI_FIX'] as const

const withPr = (phase: Phase): AgentState => state(phase, { prNumber: 7, prUrl: 'https://example.test/pull/7' })

describe('the /fix vocabulary entry', () => {
  test('joins SLASH_COMMANDS carrying the CI-failed signal — the move the red-run door makes', () => {
    expect(SLASH_COMMANDS).toContain('/fix')
    // The shared-budget guarantee starts here: /fix injects the one signal
    // whose transition increments ciAttempts, so both doors spend the same
    // counter through the same move.
    expect(COMMAND_SIGNALS['/fix']).toBe('CI_FAILED')
  })

  test('parses from a line start, with and without an argument', () => {
    expect(parseSlashCommand('/fix')).toEqual({ command: '/fix', argument: '' })
    expect(parseSlashCommand('/fix the mutation gate went red again')).toEqual({
      command: '/fix',
      argument: 'the mutation gate went red again',
    })
  })

  test('is ignored inside a fenced block, like every command', () => {
    expect(parseSlashCommand('Example:\n```\n/fix\n```\n')).toBeNull()
  })

  test.each([['/fixed'], ['/fixture'], ['/fix-it'], ['/fixup']])(
    'never matches %p — no command is a prefix of another',
    (body) => {
      expect(parseSlashCommand(body)).toBeNull()
    },
  )
})

/** The two phases whose `CI_FAILED` rows the transition table carries. */
const CI_DOOR_PHASES: ReadonlySet<string> = new Set(['COMPLETE', 'PR_DELIVERY'])

describe('acceptedCommands offers /fix exactly where the red-run door is admitted', () => {
  test.each(['COMPLETE', 'PR_DELIVERY'])('%s with a pull request offers it', (phase: Phase) => {
    expect(acceptedCommands(withPr(phase))).toContain('/fix')
  })

  test.each(['COMPLETE', 'PR_DELIVERY'])('%s without a pull request does not', (phase: Phase) => {
    // The gate reads persisted state only (D2): with nothing pushed there is
    // nothing to repair, and the offer must not disagree with the gate.
    expect(acceptedCommands(state(phase))).not.toContain('/fix')
  })

  test.each([...PHASES.filter((phase) => !CI_DOOR_PHASES.has(phase))])(
    '%s never offers it, with or without a pull request',
    (phase: Phase) => {
      // Phase admission stays in the transition table via `accepts`, so every
      // phase without a CI_FAILED row excludes the command even when a pull
      // request is named — the offer and the gate are one predicate table.
      expect(acceptedCommands(withPr(phase))).not.toContain('/fix')
      expect(acceptedCommands(state(phase))).not.toContain('/fix')
    },
  )
})

describe('the /sync vocabulary entry', () => {
  test('joins SLASH_COMMANDS and injects no signal — the transition table is never consulted', () => {
    expect(SLASH_COMMANDS).toContain('/sync')
    // The non-moving guarantee, asserted so a later edit that gives /sync a
    // signal cannot pass quietly: a signal would make /sync a state move, and
    // every park/resume question the design declined would come back with it.
    expect(COMMAND_SIGNALS['/sync']).toBeUndefined()
  })
})

describe('acceptedCommands offers /sync exactly when the agent branch exists', () => {
  test.each([...PR_PHASES])('%s with a pull request offers it', (phase: Phase) => {
    expect(acceptedCommands(withPr(phase))).toContain('/sync')
  })

  test('the drift-park shape — FAILED, no pull request, work on the branch — offers it', () => {
    // Issue #323: the run refused on drifted manifests, parked in FAILED
    // before any pull request existed, and the only machine remedy was gated
    // behind a pull request that nothing would open while the branch could
    // not run a job.
    expect(acceptedCommands(state('FAILED', { resumeFrom: 'REVIEW_AND_MUTATE' }))).toContain('/sync')
  })

  test('a waiting phase on a captured branch offers it too — merging base is safe anywhere', () => {
    expect(acceptedCommands(state('DESIGN_SPEC'))).toContain('/sync')
    expect(acceptedCommands(state('PLAN_REVIEW'))).toContain('/sync')
  })

  test('a pre-capture state never offers it — there is no branch to merge into', () => {
    expect(acceptedCommands(state('INIT_OR_CLARIFY', { changeName: null }))).not.toContain('/sync')
    expect(acceptedCommands(state('FAILED', { changeName: null, resumeFrom: 'INIT_OR_CLARIFY' }))).not.toContain(
      '/sync',
    )
  })

  test('a cancelled issue never offers it — /cancel deleted the branch this would resurrect', () => {
    // The one branch-less state that still names a change: the same
    // `presentationKey` split `/review` uses, for the same reason.
    expect(acceptedCommands(state('COMPLETE'))).not.toContain('/sync')
    expect(acceptedCommands(withPr('COMPLETE'))).toContain('/sync')
  })
})

describe('the wrong-command refusal lists /sync exactly when it applies', () => {
  test('a refusal in a branch-bearing phase names /sync among what works', () => {
    const rendered = renderRefusedCommand('/retry', 'COMPLETE', acceptedCommands(withPr('COMPLETE')))

    expect(rendered).toContain('`/sync`')
  })

  test('a refusal on a drift-parked issue names it too', () => {
    const rendered = renderRefusedCommand('/review', 'FAILED', acceptedCommands(state('FAILED')))

    expect(rendered).toContain('`/sync`')
  })

  test('a refusal on a pre-capture issue does not name it', () => {
    const rendered = renderRefusedCommand('/retry', 'FAILED', acceptedCommands(state('FAILED', { changeName: null })))

    expect(rendered).not.toContain('`/sync`')
  })
})
