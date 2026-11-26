// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { experimental_createSteering } from 'ai'

import { logger } from '../logger.js'
import type { RunControl, SteeringHandle } from './types.js'

const log = logger.child({ scope: 'run-control:steering' })

/**
 * Cancelled model calls per run. An interrupt that lands while tools run costs
 * nothing, but it is still counted, which keeps the bound conservative.
 */
export const MAX_INTERRUPTS_PER_RUN = 3

/** One fresh SDK steering handle per `generateText` call — the SDK forbids reuse. */
export const createSdkSteering = (): SteeringHandle => experimental_createSteering()

/**
 * Record a mid-run message as steering text. While the interrupt budget allows and
 * the run is not stopping, the SDK cancels the in-flight model call and redoes the
 * step with the text; otherwise it delivers at the next step boundary. An outcome
 * that rejects despite the never-rejects contract is still preserved as a leftover.
 *
 * `persistInHistory: false` marks the text as excluded from the turn's persisted
 * history — the W1 edit notice whose correction is already stored in the rewritten
 * user turn. The exclusion is recorded at request time, so it survives the outcome
 * settling after the model loop returns. Logs carry counts, never steering text.
 */
export function requestSteer(run: RunControl, text: string, opts: { persistInHistory?: boolean } = {}): void {
  if (opts.persistInHistory === false) {
    run.excludedSteerTexts.push(text)
    log.debug(
      { contextId: run.contextId, turnId: run.turnId, excludedSteerCount: run.excludedSteerTexts.length },
      'Steering text excluded from persisted history',
    )
  }
  const interrupt = !run.stopRequested && run.interruptsRequested < MAX_INTERRUPTS_PER_RUN
  if (interrupt) {
    run.interruptsRequested += 1
  } else {
    log.debug(
      { contextId: run.contextId, turnId: run.turnId, interruptsRequested: run.interruptsRequested },
      'Steering without an interrupt request',
    )
  }
  const outcome = (interrupt ? run.steering.steer(text, { interrupt: true }) : run.steering.steer(text)).then(
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
