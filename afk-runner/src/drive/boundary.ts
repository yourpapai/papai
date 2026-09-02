// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendEvent } from '../events.js'
import type { EventInput, SddEvent } from '../events.js'
import { foldLogOrInitial } from '../kernel/fold.js'
import { step } from '../kernel/machine.js'
import type { KernelEvent, KernelMachine } from '../kernel/machine.js'

export interface AppendBoundaryDeps {
  readonly now?: () => Date
}

export interface AppendBoundary {
  /** The only write path to the run log; validates stage enters against the graph before appending. */
  readonly append: (event: EventInput) => SddEvent
}

/**
 * Append boundary (design D5): every `stage_enter` is probed with the pure
 * `transition()` — a snapshot returned identical by reference with zero
 * executable actions means no edge fired, so the append is refused and throws
 * at the edge. The log records only validated transitions. Non-enter events
 * are root-level bookkeeping and append directly.
 */
export function createAppendBoundary(
  machine: KernelMachine,
  logPath: string,
  deps: AppendBoundaryDeps = {},
): AppendBoundary {
  return {
    append: (event) => {
      if (event.type === 'stage_enter') {
        const snapshot = foldLogOrInitial(machine, logPath).snapshot
        const kernelEvent: KernelEvent = { type: 'stage.enter', stage: event.stage }
        const [next, actions] = step(machine, snapshot, kernelEvent)
        if (next === snapshot && actions.length === 0) {
          const position = typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
          throw new Error(`append refused: stage_enter ${event.stage} has no legal edge from '${position}'`)
        }
      }
      return appendEvent(logPath, event, deps.now?.())
    },
  }
}
