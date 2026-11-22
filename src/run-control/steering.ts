// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { experimental_createSteering } from 'ai'

import type { RunControl, SteeringHandle } from './types.js'

/** One fresh SDK steering handle per `generateText` call — the SDK forbids reuse. */
export const createSdkSteering = (): SteeringHandle => experimental_createSteering()

/**
 * Record a mid-run message as steering text. The SDK delivers it at the next step
 * boundary and resolves its outcome there (or when the loop ends); an outcome that
 * rejects despite the never-rejects contract is still preserved as a leftover.
 */
export function requestSteer(run: RunControl, text: string): void {
  const outcome = run.steering.steer(text).then(
    (result) => (result.type === 'delivered' ? null : { text }),
    () => ({ text }),
  )
  run.pendingSteerOutcomes.push({ text, outcome })
}

/**
 * Classify every pending steer as delivered or leftover, in arrival order. Outcomes
 * can resolve after the model loop returns, so they are awaited before leftovers are
 * read. A handle that never started delivers nothing — its `steer()` promises never
 * settle — so those texts become leftovers immediately instead of stalling the turn.
 */
export async function settleSteering(run: RunControl): Promise<void> {
  const pending = run.pendingSteerOutcomes
  run.pendingSteerOutcomes = []
  if (!run.steeringStarted) {
    for (const { text } of pending) run.steerLeftovers.push({ text })
    return
  }
  const leftovers = await Promise.all(pending.map(({ outcome }) => outcome))
  for (const leftover of leftovers) {
    if (leftover !== null) run.steerLeftovers.push(leftover)
  }
}
