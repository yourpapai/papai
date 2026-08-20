// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { STAGE_ORDER } from './events.js'
import type { DepthProfile, EventInput, StageId } from './events.js'

export class StageHaltError extends Error {
  constructor(
    message: string,
    readonly resumeHint?: string,
  ) {
    super(message)
    this.name = 'StageHaltError'
  }
}

export function remainingStages(from: StageId, depth: DepthProfile | null): StageId[] {
  const start = STAGE_ORDER.indexOf(from)
  return STAGE_ORDER.slice(start).filter((stage) => !(stage === 'atomicity' && depth === 'S'))
}

export type StageEmit = (event: EventInput) => void

export interface StageMachineDeps {
  readonly emit: StageEmit
}

export interface StageMachine {
  readonly runStage: (stage: StageId, fn: () => Promise<void>) => Promise<void>
}

export function createStageMachine(deps: StageMachineDeps): StageMachine {
  return {
    runStage: async (stage, fn) => {
      deps.emit({ altitude: 'L2', type: 'stage_enter', stage })
      await fn()
      deps.emit({ altitude: 'L2', type: 'stage_exit', stage })
    },
  }
}
