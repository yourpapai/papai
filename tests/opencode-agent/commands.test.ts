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
import { PHASES } from '../../opencode-agent/src/types.js'
import type { AgentState, Phase } from '../../opencode-agent/src/types.js'

/**
 * `/sync` joins the vocabulary as the `/ask` shape: a non-moving side
 * operation, accepted wherever a pull request exists and refused as a wrong
 * command everywhere else.
 *
 * What these tests pin is the one rule with two readers — the offer a refusal
 * lists and the gate that enforces it are both `COMMAND_APPLIES`, so they
 * cannot drift — plus the property that makes the whole command safe to accept
 * in any PR-bearing phase: it injects no signal, so the transition table is
 * never consulted and no park/resume question exists to answer.
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
  tokensSpent: 0,
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

describe('acceptedCommands offers /sync exactly when a pull request exists', () => {
  test.each([...PR_PHASES])('%s with a pull request offers it', (phase: Phase) => {
    expect(acceptedCommands(withPr(phase))).toContain('/sync')
  })

  test.each([...PR_PHASES])('%s without a pull request does not', (phase: Phase) => {
    expect(acceptedCommands(state(phase))).not.toContain('/sync')
  })

  test('a pre-delivery phase never offers it, with or without a pull request field', () => {
    // `/sync` on a PR-less state is declined by design (proposal Non-goals):
    // a FAILED-before-delivery branch is re-entered by `/retry`, which re-runs
    // from it. The predicate carries that scope by keying on `prNumber` alone,
    // so the offer cannot leak into the pre-delivery conversation.
    expect(acceptedCommands(state('DESIGN_SPEC'))).not.toContain('/sync')
    expect(acceptedCommands(state('PLAN_REVIEW'))).not.toContain('/sync')
  })
})

describe('the wrong-command refusal lists /sync exactly when it applies', () => {
  test('a refusal in a PR-bearing phase names /sync among what works', () => {
    const rendered = renderRefusedCommand('/retry', 'COMPLETE', acceptedCommands(withPr('COMPLETE')))

    expect(rendered).toContain('`/sync`')
  })

  test('a refusal on a PR-less issue does not name it', () => {
    const rendered = renderRefusedCommand('/retry', 'FAILED', acceptedCommands(state('FAILED')))

    expect(rendered).not.toContain('`/sync`')
  })
})
