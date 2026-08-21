// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { describeActivity } from '../../opencode-agent/src/activity.js'
import type { Activity } from '../../opencode-agent/src/activity.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import { createProgressTracker } from '../../opencode-agent/src/progress.js'
import { foldStall, noStall, reportStall } from '../../opencode-agent/src/turn-stall.js'
import type { TurnStall } from '../../opencode-agent/src/turn-stall.js'

/**
 * The stall record's own clock, which the 2026-08-21 incident added.
 *
 * `retries` and `failure` say *what* the provider was getting wrong since the
 * last finished step; `lastProgressAt` says *how long* that has been going on,
 * and without it the record could only be judged when a turn returned — which a
 * never-returning turn bypasses. Four runs burned 90 minutes each exactly
 * there: the gateway answered HTTP 200 and streamed nothing, the session
 * retried the identical request 78 times, and the whole-turn deadline was the
 * only bound that ever fired.
 *
 * The division of labour is the design: `foldStall` stays **pure** (it clears
 * retry evidence on a step and preserves the old stamp), and the tracker in
 * `progress.ts` does the stamping — on every finished step, on every newly
 * started tool call (a tool starting is as much proof the model answered as a
 * finished step), and once at creation, so the window is measured from a real
 * instant even in a turn that never decodes a single event.
 */

const SESSION = 'ses_02414f224ffejPyZrczmjjX3YF'

/**
 * The same recorded fixtures `progress.test.ts` carries — see that file for
 * the provenance of each shape.
 */
const RETRY = {
  id: 'evt_fdc068971001Bla9VvtK5laCtU',
  type: 'session.status',
  properties: {
    sessionID: SESSION,
    status: { type: 'retry', attempt: 1, message: 'slow down', next: 1786102845761 },
  },
} as const

const BUSY = { type: 'session.status', properties: { sessionID: SESSION, status: { type: 'busy' } } } as const

const STEP_FINISH = {
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: {
      type: 'step-finish',
      tokens: { input: 1200, output: 340, reasoning: 12 },
      cost: 0.004,
    },
  },
} as const

const TOOL_RUNNING = {
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: {
      type: 'tool',
      tool: 'read',
      callID: 'call_1',
      state: { status: 'running', input: { filePath: '/package.json' }, time: { start: 1786101044113 } },
    },
  },
} as const

const TOOL_COMPLETED = {
  type: 'message.part.updated',
  properties: {
    sessionID: SESSION,
    part: {
      type: 'tool',
      tool: 'read',
      callID: 'call_1',
      state: { status: 'completed', input: { filePath: '/package.json' } },
    },
  },
} as const

const silentLogger = (): Logger => ({
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
})

/** A clock the test moves by hand, so the stamps are exact rather than sampled. */
const manualClock = (start = 1_000_000): { now: () => number; advance: (ms: number) => void } => {
  let current = start
  return {
    now: (): number => current,
    advance: (ms): void => {
      current += ms
    },
  }
}

/** Decodes a fixture to its activity, so a fold test feeds the fold, not the event. */
const activityOf = (event: unknown): Activity => {
  const activity = describeActivity(event, SESSION)
  if (activity === null) throw new Error(`fixture did not decode: ${JSON.stringify(event)}`)
  return activity
}

describe('the stall record carries a clock', () => {
  test('noStall names the instant it was created at', () => {
    expect(noStall(1_234)).toEqual({ retries: 0, failure: null, lastProgressAt: 1_234 })
  })

  test('foldStall is pure: a step clears the evidence and keeps the old stamp for the tracker to move', () => {
    // The tracker re-stamps `lastProgressAt` on a step; the fold's job is only
    // the evidence. Keeping the old stamp here is what leaves the fold a pure
    // function of its arguments — no clock, no side channel.
    const stalled: TurnStall = { retries: 4, failure: { name: 'APIError', statusCode: 429 }, lastProgressAt: 5_000 }

    const folded = foldStall(stalled, activityOf(STEP_FINISH))

    expect(folded).toEqual({ retries: 0, failure: null, lastProgressAt: 5_000 })
    // And pure means the input is untouched, too.
    expect(stalled.retries).toBe(4)
  })

  test('a retry folds without touching the stamp', () => {
    const folded = foldStall({ retries: 0, failure: null, lastProgressAt: 9_000 }, activityOf(RETRY))

    expect(folded).toEqual({ retries: 1, failure: null, lastProgressAt: 9_000 })
  })

  test('an unrelated activity is still a no-op, stamp included', () => {
    const stall: TurnStall = { retries: 0, failure: null, lastProgressAt: 9_000 }

    expect(foldStall(stall, activityOf(BUSY))).toBe(stall)
  })
})

describe('the tracker stamps the clock', () => {
  test('at creation, so the window is measured from a real instant even before any event', () => {
    const clock = manualClock(2_000)
    const tracker = createProgressTracker(SESSION, silentLogger(), { now: clock.now })

    clock.advance(60_000)
    tracker.observe(RETRY)

    const stall = tracker.stall()
    expect(stall).toMatchObject({ retries: 1 })
    // Sixty seconds after a tracker created at t=2000, the last progress the
    // record names is the creation instant itself.
    expect(stall?.lastProgressAt).toBe(2_000)
  })

  test('on every finished step, clearing the evidence as it did before', () => {
    const clock = manualClock(3_000)
    const tracker = createProgressTracker(SESSION, silentLogger(), { now: clock.now })

    tracker.observe(RETRY)
    clock.advance(10_000)
    tracker.observe(STEP_FINISH)

    expect(tracker.stall()).toBeNull()

    // And the stamp moved, so a *fresh* spiral starts a fresh window: observe
    // more retries and the clock they are measured against is the step.
    clock.advance(5_000)
    tracker.observe(RETRY)
    expect(tracker.stall()?.lastProgressAt).toBe(13_000)
  })

  test('on every newly started tool call — a tool starting is proof the model answered', () => {
    const clock = manualClock(4_000)
    const tracker = createProgressTracker(SESSION, silentLogger(), { now: clock.now })

    tracker.observe(RETRY)
    clock.advance(7_000)
    tracker.observe(TOOL_RUNNING)

    // The evidence survives — a tool call does not clear what the provider got
    // wrong — but the clock restarts, which is what the watcher reads.
    const stall = tracker.stall()
    expect(stall?.retries).toBe(1)
    expect(stall?.lastProgressAt).toBe(11_000)
  })

  test('a republished running event for a call already running moves nothing', () => {
    const clock = manualClock(5_000)
    const tracker = createProgressTracker(SESSION, silentLogger(), { now: clock.now })

    tracker.observe(TOOL_RUNNING)
    clock.advance(30_000)
    tracker.observe(TOOL_RUNNING)
    // Evidence after the republish, so the record has something to report —
    // `stall()` is null without it, by the both-halves-required rule.
    tracker.observe(RETRY)

    expect(tracker.snapshot().toolCalls).toBe(1)
    expect(tracker.stall()?.lastProgressAt).toBe(5_000)
  })

  test('a tool completing is not progress — the model is who we are waiting on again', () => {
    const clock = manualClock(6_000)
    const tracker = createProgressTracker(SESSION, silentLogger(), { now: clock.now })

    tracker.observe(TOOL_RUNNING)
    clock.advance(8_000)
    tracker.observe(TOOL_COMPLETED)
    tracker.observe(RETRY)

    expect(tracker.stall()?.lastProgressAt).toBe(6_000)
  })

  test('the fixtures here decode as the kinds they claim to be', () => {
    // A guard on the test's own inputs: each fixture must decode to the event
    // family its case depends on, or the case above asserts nothing.
    expect(describeActivity(RETRY, SESSION)?.kind).toBe('status')
    expect(describeActivity(STEP_FINISH, SESSION)?.kind).toBe('step')
    expect(describeActivity(TOOL_RUNNING, SESSION)?.kind).toBe('tool')
    expect(describeActivity(BUSY, SESSION)?.kind).toBe('status')
  })
})

describe('reportStall', () => {
  test('carries the stamp out with the evidence', () => {
    expect(reportStall({ retries: 0, failure: null, lastProgressAt: 1 })).toBeNull()
    expect(reportStall({ retries: 2, failure: null, lastProgressAt: 77 })).toEqual({
      retries: 2,
      failure: null,
      lastProgressAt: 77,
    })
  })
})
