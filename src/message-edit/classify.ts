// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LastTurn } from '../run-control/last-turn-registry.js'
import type { RunControl } from '../run-control/types.js'

export type EditWindow = 'w1' | 'w2' | 'w3'

export type ClassifyEditInput = {
  editedMessageId: string
  activeRun: RunControl | undefined
  lastTurn: LastTurn | undefined
  laterUserMessageExists: boolean
}

export function classifyEdit(input: ClassifyEditInput): EditWindow {
  const { editedMessageId, activeRun, lastTurn, laterUserMessageExists } = input
  if (activeRun !== undefined) {
    return activeRun.originatingMessageIds.includes(editedMessageId) ? 'w1' : 'w3'
  }
  if (lastTurn !== undefined && lastTurn.originatingMessageIds.includes(editedMessageId) && !laterUserMessageExists) {
    return 'w2'
  }
  return 'w3'
}
