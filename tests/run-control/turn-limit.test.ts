// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createTurnLimitTracker, TURN_LIMIT_STOP_REASON } from '../../src/run-control/turn-limit.js'

type ConditionArg = { steps: unknown[] }
type FakeStepCondition = (arg: ConditionArg) => boolean
type FakeStepCountIsFactory = (maxSteps: number) => FakeStepCondition
type FakeStepCountIsFixture = {
  stepCountIs: FakeStepCountIsFactory
  forwardedMaxSteps: number[]
  receivedArgs: ConditionArg[]
}

/**
 * Controllable stand-in for the injected `deps.stepCountIs` factory: records the
 * maxSteps it is asked for (once per factory call), then hands back a condition
 * that replays `verdicts` in order (clamped to the last one) while capturing
 * every arg it receives.
 */
const createFakeStepCountIs = (verdicts: readonly boolean[]): FakeStepCountIsFixture => {
  const forwardedMaxSteps: number[] = []
  const receivedArgs: ConditionArg[] = []
  let verdictIndex = 0
  const stepCountIs: FakeStepCountIsFactory = (maxSteps: number): FakeStepCondition => {
    forwardedMaxSteps.push(maxSteps)
    return (arg: ConditionArg): boolean => {
      receivedArgs.push(arg)
      const verdict = verdicts[Math.min(verdictIndex, verdicts.length - 1)]
      verdictIndex += 1
      return verdict ?? false
    }
  }
  return { stepCountIs, forwardedMaxSteps, receivedArgs }
}

describe('createTurnLimitTracker', () => {
  test('forwards maxSteps to the injected predicate exactly once, at creation', () => {
    const { stepCountIs, forwardedMaxSteps } = createFakeStepCountIs([false])
    createTurnLimitTracker(stepCountIs, 125)
    expect(forwardedMaxSteps).toEqual([125])
  })

  test('passes the predicate verdict through unchanged, forwarding the received args', async () => {
    const { stepCountIs, receivedArgs } = createFakeStepCountIs([true, false])
    const { condition } = createTurnLimitTracker(stepCountIs, 125)
    const arg = { steps: [] }
    expect(await condition(arg)).toBe(true)
    expect(await condition(arg)).toBe(false)
    expect(receivedArgs).toEqual([arg, arg])
  })

  test('latches hit on the first true verdict and keeps it through later false verdicts', async () => {
    const { stepCountIs } = createFakeStepCountIs([false, true, false])
    const tracker = createTurnLimitTracker(stepCountIs, 125)
    expect(tracker.hit).toBe(false)
    expect(await tracker.condition({ steps: [] })).toBe(false)
    expect(tracker.hit).toBe(false)
    expect(await tracker.condition({ steps: [] })).toBe(true)
    expect(tracker.hit).toBe(true)
    expect(await tracker.condition({ steps: [] })).toBe(false)
    expect(tracker.hit).toBe(true)
  })

  test('hit stays false while every verdict is false', async () => {
    const { stepCountIs } = createFakeStepCountIs([false, false, false])
    const tracker = createTurnLimitTracker(stepCountIs, 125)
    for (let index = 0; index < 3; index += 1) {
      expect(await tracker.condition({ steps: [] })).toBe(false)
      expect(tracker.hit).toBe(false)
    }
  })
})

describe('TURN_LIMIT_STOP_REASON', () => {
  test('is the turn_limit marker string', () => {
    expect(TURN_LIMIT_STOP_REASON).toBe('turn_limit')
  })
})
