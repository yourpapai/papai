// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  claudeExitError,
  claudeResultError,
  dependencyDriftError,
  isClaudeExit,
  isClaudeResult,
  isDependencyDrift,
  isRetryFutile,
  isTurnDeadline,
  isTurnStall,
  modelResponseError,
  openCodeError,
  providerStalledError,
  pullRequestForbiddenError,
  serverGoneError,
  turnDeadlineError,
  turnStallError,
} from '../../opencode-agent/src/errors.js'
import type { ProgressSnapshot } from '../../opencode-agent/src/progress.js'
import type { TurnStall } from '../../opencode-agent/src/turn-stall.js'

/**
 * `TURN_STALL` — the mid-turn provider-stall stop, said in a way the phase can
 * act on and a maintainer can believe.
 *
 * It sits between the two failures that already carry codes, and the message
 * has to be distinguishable from both. Unlike `TURN_DEADLINE` this is not "a
 * ceiling was reached in a run where nothing broke": the provider broke, and
 * the turn is aborted *because* it is not being served — well before the
 * whole-turn deadline would have fired, which on the incident runs was 90
 * minutes away. Unlike `PROVIDER_STALLED` it may carry partial work worth
 * salvaging, and the handler branches on the code for exactly that reason.
 */

const PROGRESS: ProgressSnapshot = { lastAction: 'read (running)', toolCalls: 44, tokens: 531_000, cost: 12.4 }

const STALL: TurnStall = { retries: 78, failure: { name: 'APIError', statusCode: 429 }, lastProgressAt: 0 }

/** Retries but no `session.error`: the shape the 2026-08-22 socket kills produced. */
const UNATTRIBUTED: TurnStall = { retries: 10, failure: null, lastProgressAt: 0 }

describe('turnStallError', () => {
  test('carries the TURN_STALL code, the stall window, the retry count and the progress', () => {
    const error = turnStallError(300_000, STALL, PROGRESS)

    expect(error.code).toBe('TURN_STALL')
    expect(error.progress).toEqual(PROGRESS)
    expect(error.message).toContain('300000')
    expect(error.message).toContain('78')
    expect(error.message).toContain('APIError')
    expect(error.message).toContain('429')
  })

  test('names the progress the turn had made, in the same terms the deadline error uses', () => {
    const message = turnStallError(300_000, STALL, PROGRESS).message

    expect(message).toContain('44 tool calls')
    expect(message).toContain('531,000 tokens')
    expect(message).toContain('read (running)')
  })

  test('names the stall, never the whole-turn deadline', () => {
    const message = turnStallError(300_000, STALL, PROGRESS).message

    expect(message).toContain('AGENT_STALL_TIMEOUT_MS')
    // `AGENT_TIMEOUT_MS` is the other bound and the other remedy; naming it
    // here sends a maintainer to raise the wrong knob — the incident runs were
    // killed by that bound precisely because nothing named the real problem.
    expect(message).not.toContain('AGENT_TIMEOUT_MS')
  })

  test('invites /retry, because a provider wave clears with time', () => {
    expect(turnStallError(300_000, STALL, PROGRESS).message).toContain('/retry')
  })

  test('says what the two conditions were, so a reader can tell slow from stalled', () => {
    const message = turnStallError(300_000, STALL, PROGRESS).message

    expect(message).toContain('no finished step')
    expect(message).toContain('no new tool call')
  })

  test('blames the provider only when the provider actually published an error', () => {
    // The attributed case: a `session.error` with a name and a status is the
    // evidence that the remote refused the request, so naming it is honest.
    const message = turnStallError(300_000, STALL, PROGRESS).message

    expect(message).toContain('the provider kept failing the request')
  })

  test('does not blame the provider when no provider error was ever published', () => {
    // The 2026-08-22 runs: retries accumulated, `session.error` never fired, and
    // the message asserted a provider stall anyway. The provider was healthy —
    // this job's own loopback proxy was cutting the socket on Bun's ten-second
    // idle bound. A message that names a culprit the evidence does not support
    // sends every reader to the wrong end of the connection.
    const message = turnStallError(300_000, UNATTRIBUTED, PROGRESS).message

    expect(message).not.toContain('the provider kept failing the request')
    expect(message).toContain('10 times')
    expect(message).toContain('no error of its own')
  })

  test('names the loopback hop as a suspect when nothing said who refused', () => {
    const message = turnStallError(300_000, UNATTRIBUTED, PROGRESS).message

    expect(message).toContain('loopback proxy')
  })

  test('still invites /retry and names its own window when the cause is unattributed', () => {
    // The remedy does not depend on knowing who refused: the work is on the
    // branch either way, and the resume point is the same.
    const message = turnStallError(300_000, UNATTRIBUTED, PROGRESS).message

    expect(message).toContain('/retry')
    expect(message).toContain('AGENT_STALL_TIMEOUT_MS')
    expect(message).not.toContain('AGENT_TIMEOUT_MS')
    expect(message).toContain('44 tool calls')
  })

  test('counts a single retry in the singular', () => {
    const once: TurnStall = { retries: 1, failure: null, lastProgressAt: 0 }

    expect(turnStallError(300_000, once, PROGRESS).message).toContain('retried the request 1 time and')
  })
})

describe('isTurnStall', () => {
  test('matches the stall and rejects every other shape', () => {
    expect(isTurnStall(turnStallError(300_000, STALL, PROGRESS))).toBe(true)

    expect(isTurnStall(turnDeadlineError(1_800_000, PROGRESS))).toBe(false)
    expect(isTurnStall(providerStalledError(STALL))).toBe(false)
    expect(isTurnStall(openCodeError('rate limited'))).toBe(false)
    expect(isTurnStall(new Error('rate limited'))).toBe(false)
    expect(isTurnStall(null)).toBe(false)
  })

  test('keeps the deadline predicate honest beside it', () => {
    // The two codes a handler branches on must stay mutually exclusive: the
    // salvage treats them alike, but the park does not, and a predicate that
    // answered true for both would send a stall down the wrong door.
    const stall = turnStallError(300_000, STALL, PROGRESS)

    expect(isTurnDeadline(stall)).toBe(false)
    expect(isTurnDeadline(turnDeadlineError(1_800_000, PROGRESS))).toBe(true)
  })
})

describe('dependencyDriftError', () => {
  test('names the drifted files and fields and both ways back in step, never a bare /retry', () => {
    // The message reaches the issue as `lastError` while the footer above it
    // used to invite a `/retry` by reflex — so it has to say up front that a
    // retry alone cannot change the condition, and name the two moves that
    // can: `/sync`, on the issue or the pull request, and a hand merge. The
    // field-per-file rendering is the maintainer's first question answered:
    // which knob moved, in which manifest.
    const error = dependencyDriftError('agent/issue-323', 'master', [
      { file: 'bun.lock', fields: [] },
      { file: 'sdd-runner/package.json', fields: ['devDependencies'] },
    ])

    expect(error.code).toBe('DEPENDENCY_DRIFT')
    expect(error.progress).toBeNull()
    const message = error.message
    expect(message).toContain('bun.lock, sdd-runner/package.json (devDependencies)')
    expect(message).toContain('`agent/issue-323`')
    expect(message).toContain('`master`')
    expect(message).toContain('/sync')
    // The remedy must be reachable from the state it is rendered for: issue
    // #323 was parked FAILED with no pull request, and a `/sync` that only
    // worked on a pull request was a door out of a room with no door.
    expect(message).toContain('on this issue, or on the pull request')
    expect(message).toContain('not something `/retry` can change')
    expect(message).toContain('cannot install from the agent branch by design')
  })

  test('renders a whole-file refusal — the lockfile — with no field list', () => {
    const error = dependencyDriftError('agent/issue-323', 'master', [{ file: 'bun.lock', fields: [] }])

    expect(error.message).toContain('(bun.lock)')
    expect(error.message).not.toContain('bun.lock (')
  })
})

describe('the retry-futile predicates', () => {
  test('a drift refusal is a drift and is retry-futile', () => {
    const drift = dependencyDriftError('agent/issue-323', 'master', [{ file: 'bun.lock', fields: [] }])

    expect(isDependencyDrift(drift)).toBe(true)
    expect(isRetryFutile(drift)).toBe(true)
  })

  test('a settings-gated refusal is retry-futile but not a drift', () => {
    const forbidden = pullRequestForbiddenError('https://example.test/compare/x', 'agent/issue-1')

    expect(isDependencyDrift(forbidden)).toBe(false)
    expect(isRetryFutile(forbidden)).toBe(true)
  })

  test('the work breaking is neither', () => {
    const broke = modelResponseError('no JSON object', '{}')

    expect(isDependencyDrift(broke)).toBe(false)
    expect(isRetryFutile(broke)).toBe(false)
    expect(isDependencyDrift(new Error('an ordinary crash'))).toBe(false)
    expect(isRetryFutile(new Error('an ordinary crash'))).toBe(false)
  })
})

/**
 * The claude turn family — two codes beside the deadline and the stall, for
 * failures classified *after* the CLI process has already exited (where the
 * alive-probe would mislabel them) or before it ever started meaningfully.
 * Distinguishable from every other turn code, because `runTurn`'s bypass list
 * and the phase's salvage decisions branch on exactly that.
 */
describe('the claude turn-family codes', () => {
  test('CLAUDE_EXIT carries the exit code and a stderr tail', () => {
    const error = claudeExitError(2, 'usage: claude ... unknown flag --nope')

    expect(error.code).toBe('CLAUDE_EXIT')
    expect(error.message).toContain('2')
    expect(error.message).toContain('unknown flag')
  })

  test('CLAUDE_RESULT carries what the result line got wrong', () => {
    const error = claudeResultError('the result line signalled an error')

    expect(error.code).toBe('CLAUDE_RESULT')
    expect(error.message).toContain('result line')
  })

  test('each predicate matches its own code and no other turn-family shape', () => {
    const exit = claudeExitError(1, 'boom')
    const result = claudeResultError('no result line arrived')

    expect(isClaudeExit(exit)).toBe(true)
    expect(isClaudeResult(result)).toBe(true)
    expect(isClaudeExit(result)).toBe(false)
    expect(isClaudeResult(exit)).toBe(false)
    expect(isClaudeExit(turnDeadlineError(1_800_000, PROGRESS))).toBe(false)
    expect(isClaudeResult(turnStallError(300_000, STALL, PROGRESS))).toBe(false)
    expect(isClaudeExit(serverGoneError('socket closed'))).toBe(false)
    expect(isClaudeResult(providerStalledError(STALL))).toBe(false)
    expect(isClaudeExit(openCodeError('rate limited'))).toBe(false)
    expect(isClaudeExit(new Error('rate limited'))).toBe(false)
    expect(isClaudeExit(null)).toBe(false)
  })
})
