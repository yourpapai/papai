// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import { logger } from '../logger.js'
import { lastTurnRegistry } from './last-turn-registry.js'
import { settleSteering } from './steering.js'
import type { InjectedMessage, RunControl, SteeringHandle } from './types.js'

const log = logger.child({ scope: 'run-control:registry' })

/** A promise nothing resolves: only a steering run the SDK started settles its outcomes. */
const neverSettles = (): Promise<never> =>
  new Promise<never>(() => {
    // Settled by the SDK's steering run; this handle never starts one.
  })

/**
 * Handle for a run begun without one (tests and non-interactive paths). It never
 * starts, so `settleSteering` reads every pending text as a leftover instead of
 * waiting on an outcome nothing can resolve.
 */
const unstartedSteering: SteeringHandle = { steer: neverSettles, queue: neverSettles }

export class RunRegistry {
  private runs = new Map<string, RunControl>()

  begin(
    contextId: string,
    opts: {
      turnId: string
      reply: ReplyFn
      originatingMessageIds: readonly string[]
      steering?: SteeringHandle
    },
  ): RunControl {
    // A new run supersedes any prior last-turn snapshot for this context.
    lastTurnRegistry.evict(contextId)
    const run: RunControl = {
      contextId,
      turnId: opts.turnId,
      reply: opts.reply,
      abortController: new AbortController(),
      originatingMessageIds: opts.originatingMessageIds,
      replyTarget: undefined,
      steering: opts.steering ?? unstartedSteering,
      steeringStarted: false,
      pendingSteerOutcomes: [],
      steerLeftovers: [],
      interruptsRequested: 0,
      stopRequested: false,
      completedEffects: [],
    }
    this.runs.set(contextId, run)
    log.debug({ contextId, turnId: opts.turnId }, 'Run started')
    return run
  }

  get(contextId: string): RunControl | undefined {
    return this.runs.get(contextId)
  }

  /** Remove the run; settle every pending steer and return the ones never delivered. */
  async end(contextId: string): Promise<InjectedMessage[]> {
    const run = this.runs.get(contextId)
    this.runs.delete(contextId)
    if (run === undefined) return []
    await settleSteering(run)
    log.debug({ contextId, turnId: run.turnId, leftover: run.steerLeftovers.length }, 'Run ended')
    return run.steerLeftovers
  }

  /** Test-only: drop all runs (singleton reset between tests in a file). */
  clear(): void {
    this.runs.clear()
  }
}

export const runRegistry = new RunRegistry()
