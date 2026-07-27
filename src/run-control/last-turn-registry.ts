// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyTarget } from '../chat/types.js'
import { logger } from '../logger.js'
import type { EffectRecord } from './types.js'

const log = logger.child({ scope: 'run-control:last-turn' })

export type LastTurn = {
  originatingMessageIds: readonly string[]
  completedEffects: ReadonlyArray<EffectRecord>
  replyTarget: ReplyTarget | undefined
  finishedAt: number
}

class LastTurnRegistry {
  private turns = new Map<string, LastTurn>()

  record(contextId: string, turn: LastTurn): void {
    this.turns.set(contextId, turn)
    log.debug({ contextId }, 'Last turn recorded')
  }

  get(contextId: string): LastTurn | undefined {
    return this.turns.get(contextId)
  }

  evict(contextId: string): void {
    this.turns.delete(contextId)
  }

  /** Test-only: drop all turns (singleton reset between tests in a file). */
  clear(): void {
    this.turns.clear()
  }
}

export const lastTurnRegistry = new LastTurnRegistry()
