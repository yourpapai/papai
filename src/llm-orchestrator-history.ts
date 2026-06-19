// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { getCachedHistory } from './cache.js'
import { buildUserTurnMessages } from './llm-orchestrator-attachments.js'

export const buildHistory = async (
  contextId: string,
  chatUserId: string,
  modelName: string,
  userText: string,
  attachmentIds: readonly string[],
): Promise<{ baseHistory: readonly ModelMessage[]; modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const baseHistory = getCachedHistory(contextId)
  const { modelMessage, historyMessage } = await buildUserTurnMessages(
    contextId,
    chatUserId,
    modelName,
    userText,
    attachmentIds,
  )
  return { baseHistory, modelMessage, historyMessage }
}
