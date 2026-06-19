// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import { logger } from '../logger.js'
import type { InjectedMessage, RunControl } from './types.js'

const log = logger.child({ scope: 'run-control:registry' })

export class RunRegistry {
  private runs = new Map<string, RunControl>()

  begin(contextId: string, opts: { turnId: string; reply: ReplyFn }): RunControl {
    const run: RunControl = {
      contextId,
      turnId: opts.turnId,
      reply: opts.reply,
      abortController: new AbortController(),
      steerQueue: [],
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

  /** Remove the run; return any steer messages that were never injected. */
  end(contextId: string): InjectedMessage[] {
    const run = this.runs.get(contextId)
    this.runs.delete(contextId)
    if (run === undefined) return []
    log.debug({ contextId, turnId: run.turnId, leftover: run.steerQueue.length }, 'Run ended')
    return run.steerQueue
  }

  /** Test-only: drop all runs (singleton reset between tests in a file). */
  clear(): void {
    this.runs.clear()
  }
}

export const runRegistry = new RunRegistry()
