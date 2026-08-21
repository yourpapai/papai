// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  isTurnDeadline,
  isTurnStall,
  openCodeError,
  providerStalledError,
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
