// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { isStepCount } from 'ai'

/** Marker spread into `llm:end` event data when the turn step budget ended the turn. */
export const TURN_LIMIT_STOP_REASON = 'turn_limit'

/** The step-count stop condition shape produced by the injected `stepCountIs` factory. */
type StepCountCondition = ReturnType<typeof isStepCount>

/** The wrapped stop condition plus the latch recording whether it has fired. */
type TurnLimitTracker = {
  condition: StepCountCondition
  readonly hit: boolean
}

/**
 * Observation-only wrapper around the turn step-budget condition: `condition` calls the
 * injected `stepCountIs` predicate with `maxSteps` (once, at creation) and passes its
 * verdict through unchanged (the SDK awaits stop conditions, so the resolved boolean is
 * what enforcement reads), while `hit` latches true the first time the verdict is true.
 * Enforcement stays owned by the SDK condition — the tracker only records that the
 * step-count condition fired, so a cap-out can be told apart from stalls and user stops
 * after the turn ends. Create it per invocation (inside callGenerateText), so concurrent
 * turns cannot leak state into each other.
 */
export function createTurnLimitTracker(stepCountIs: typeof isStepCount, maxSteps: number): TurnLimitTracker {
  const limitCondition = stepCountIs(maxSteps)
  let hit = false
  const condition: StepCountCondition = async (options) => {
    const verdict = await limitCondition(options)
    if (verdict) {
      hit = true
    }
    return verdict
  }
  return {
    condition,
    get hit(): boolean {
      return hit
    },
  }
}
