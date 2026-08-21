// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { isTurnStall, turnStallError } from '../../opencode-agent/src/errors.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import type { ProgressSnapshot, ProgressTracker } from '../../opencode-agent/src/progress.js'
import type { SdkPromptBody } from '../../opencode-agent/src/sdk-contract.js'
import { runTurn } from '../../opencode-agent/src/turn-run.js'
import type { TurnBounds, TurnConnection } from '../../opencode-agent/src/turn-run.js'
import type { TurnStall } from '../../opencode-agent/src/turn-stall.js'

/** A syntactic prompt body; nothing in `runTurn` reads it. */
const BODY: SdkPromptBody = {
  model: { providerID: 'openai', modelID: 'gpt-5' },
  parts: [{ type: 'text', text: 'go' }],
}

/**
 * The mid-turn stall watcher, driven with an injected schedule, a fake tracker
 * and a fake clock — no real time anywhere.
 *
 * This is the half of the 2026-08-21 finding the deadline could not answer:
 * the gateway answered HTTP 200 and streamed nothing, the session retried the
 * identical request 78 times, and the turn stayed outstanding until the
 * whole-turn deadline killed it at 90 minutes. The watcher rides the
 * heartbeat's tick — one clock in the pipeline, no second timer to disagree
 * with it — and asks two questions of the tracker on every beat: has
 * `now − lastProgressAt` passed the window, and is there retry evidence since
 * that progress? **Both**, because the evidence is what separates a provider
 * wave from one very long generation.
 */

const SESSION = 'ses_02414f224ffejPyZrczmjjX3YF'
const STALL_MS = 300_000

const PROGRESS: ProgressSnapshot = { lastAction: 'read (running)', toolCalls: 44, tokens: 531_000, cost: 12.4 }

const silentLogger = (): Logger => ({
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
})

/** Fires the tick on demand rather than after a real minute. */
const manualSchedule = (): {
  schedule: (tick: () => void, everyMs: number) => { cancel: () => void }
  fire: () => void
} => {
  const handlers: Array<() => void> = []
  return {
    fire: (): void => {
      for (const tick of [...handlers]) tick()
    },
    schedule: (tick, _everyMs) => {
      handlers.push(tick)
      return { cancel: (): void => void handlers.splice(handlers.indexOf(tick), 1) }
    },
  }
}

/**
 * A tracker whose stall answer the test holds, so a beat can be made to land
 * on either side of both conditions without touching a clock.
 */
const fakeTracker = (stall: { current: TurnStall | null }): ProgressTracker => ({
  observe: (): void => {},
  snapshot: (): ProgressSnapshot => PROGRESS,
  stall: (): TurnStall | null => stall.current,
})

/** A turn that never answers, which is the shape the watcher exists for. */
const hangingConnection = (probe: { calls: number }): TurnConnection => ({
  sendPrompt: (): Promise<unknown> => new Promise((): void => {}),
  alive: (): Promise<boolean> => {
    probe.calls += 1
    return Promise.resolve(true)
  },
})

const bounds = (over: Partial<TurnBounds> = {}): TurnBounds => ({
  log: silentLogger(),
  // Unbounded, so a watcher miss cannot be a deadline firing in disguise.
  timeoutMs: 0,
  heartbeatMs: 60_000,
  stallTimeoutMs: STALL_MS,
  ...over,
})

/** Bounds whose schedule is the timer, so `fire()` is a heartbeat beat. */
const beating = (
  timer: ReturnType<typeof manualSchedule>,
  clock: { now: number },
  over: Partial<TurnBounds> = {},
): TurnBounds => bounds({ schedule: timer.schedule, now: (): number => clock.now, ...over })

const STALLED: TurnStall = { retries: 78, failure: { name: 'APIError', statusCode: 429 }, lastProgressAt: 0 }

/** What a pending turn says when it is asked, and only that. */
const STILL_PENDING = 'pending'

/** Five beats, as a helper so the test bodies stay free of loop control flow. */
const beatFiveTimes = (timer: { fire: () => void }): void => {
  timer.fire()
  timer.fire()
  timer.fire()
  timer.fire()
  timer.fire()
}

/**
 * What a turn did, without waiting on one that may never settle.
 *
 * A rejection the watcher fires lands within a microtask of the tick; the
 * sleep is the generous upper bound a pending turn needs to prove it is
 * pending, never a measure of anything.
 */
const verdictOf = (turn: Promise<unknown>): Promise<unknown> =>
  Promise.race([
    turn.then(
      (): string => 'resolved',
      (error: unknown): unknown => error,
    ),
    Bun.sleep(50).then((): string => STILL_PENDING),
  ])

describe('the mid-turn stall watcher', () => {
  test('aborts the turn when the window has passed and retry evidence is present', async () => {
    const timer = manualSchedule()
    const clock = { now: 0 }
    const tracker = fakeTracker({ current: STALLED })
    const probe = { calls: 0 }

    const turn = runTurn(hangingConnection(probe), SESSION, BODY, beating(timer, clock), tracker)

    // Not yet: the window has not passed (lastProgressAt 0, now 0).
    expect(await verdictOf(turn)).toBe('pending')
    clock.now = STALL_MS - 1
    timer.fire()
    expect(await verdictOf(turn)).toBe('pending')
    // Now: no progress for the whole window while the provider kept failing.
    clock.now = STALL_MS
    timer.fire()

    const verdict = await verdictOf(turn)
    expect(isTurnStall(verdict)).toBe(true)
  })

  test('the rejection carries what the tracker knew', async () => {
    const timer = manualSchedule()
    const clock = { now: STALL_MS }
    const tracker = fakeTracker({ current: STALLED })
    const probe = { calls: 0 }

    const turn = runTurn(hangingConnection(probe), SESSION, BODY, beating(timer, clock), tracker)
    timer.fire()

    const verdict = await verdictOf(turn)
    // `String(error)` is `PipelineError: <message>` (the class's `name`), so
    // the assertions read the text without narrowing inside the test.
    const printed = String(verdict)
    expect(printed).toContain('78')
    expect(printed).toContain('44 tool calls')
    // The factory's own message, so the notice a maintainer reads is the one
    // the classification tests already pin.
    expect(printed).toBe(`PipelineError: ${turnStallError(STALL_MS, STALLED, PROGRESS).message}`)
  })

  test('does not fire on a merely slow turn — no retry evidence, however long it thinks', async () => {
    // The healthy worst case: one model call producing no events for longer
    // than the window. Without the evidence half, the bound must stay silent —
    // this is exactly the turn the deadline owns.
    const timer = manualSchedule()
    const clock = { now: STALL_MS * 10 }
    const tracker = fakeTracker({ current: null })
    const probe = { calls: 0 }

    const turn = runTurn(hangingConnection(probe), SESSION, BODY, beating(timer, clock), tracker)
    beatFiveTimes(timer)

    expect(await verdictOf(turn)).toBe('pending')
  })

  test('does not fire when progress landed inside the window', async () => {
    // The recovering blip's mirror: retries exist, but a step or tool start
    // moved `lastProgressAt` inside the window, so the turn is being served.
    const timer = manualSchedule()
    const clock = { now: 0 }
    const tracker = fakeTracker({ current: STALLED })
    const probe = { calls: 0 }

    const turn = runTurn(hangingConnection(probe), SESSION, BODY, beating(timer, clock), tracker)
    clock.now = STALL_MS
    tracker.stall = (): TurnStall | null => ({ ...STALLED, lastProgressAt: 60_000 })
    timer.fire()

    expect(await verdictOf(turn)).toBe('pending')
  })

  test('a bound of 0 never fires, and is exactly the behaviour from before it existed', async () => {
    const timer = manualSchedule()
    const clock = { now: STALL_MS * 100 }
    const tracker = fakeTracker({ current: STALLED })
    const probe = { calls: 0 }

    const turn = runTurn(hangingConnection(probe), SESSION, BODY, beating(timer, clock, { stallTimeoutMs: 0 }), tracker)
    beatFiveTimes(timer)

    expect(await verdictOf(turn)).toBe('pending')
  })

  test('the rejection leaves before the alive() probe, like a deadline does', async () => {
    // A stall must not be relabelled a dead server: the server is up, the
    // provider is not. The probe runs only on the failure path after the two
    // pass-throughs, so a stall that reached it would be misclassified.
    const timer = manualSchedule()
    const clock = { now: STALL_MS }
    const tracker = fakeTracker({ current: STALLED })
    const probe = { calls: 0 }

    const turn = runTurn(hangingConnection(probe), SESSION, BODY, beating(timer, clock), tracker)
    timer.fire()
    await verdictOf(turn)

    expect(probe.calls).toBe(0)
  })

  test('an ordinary failure over a live server still reaches the probe untouched', async () => {
    const probe = { calls: 0 }
    const connection: TurnConnection = {
      sendPrompt: (): Promise<unknown> => Promise.reject(new Error('rate limited')),
      alive: (): Promise<boolean> => {
        probe.calls += 1
        return Promise.resolve(true)
      },
    }

    await expect(runTurn(connection, SESSION, BODY, bounds(), fakeTracker({ current: null }))).rejects.toThrow(
      'rate limited',
    )
    expect(probe.calls).toBe(1)
  })

  test('a healthy turn resolves and the watcher never says a word', async () => {
    const timer = manualSchedule()
    const clock = { now: 0 }
    const tracker = fakeTracker({ current: null })
    const connection: TurnConnection = {
      sendPrompt: (): Promise<unknown> => Promise.resolve({ data: 'answer' }),
      alive: (): Promise<boolean> => Promise.resolve(true),
    }

    const turn = runTurn(connection, SESSION, BODY, beating(timer, clock), tracker)
    timer.fire()

    await expect(turn).resolves.toEqual({ data: 'answer' })
  })
})
