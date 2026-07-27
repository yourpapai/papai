// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { getCachedHistory } from './cache.js'
import { buildUserTurnMessages } from './llm-orchestrator-attachments.js'
import type { MessageSegment } from './message-edit/segments.js'

export const buildHistory = async (
  contextId: string,
  chatUserId: string,
  modelName: string,
  userText: string,
  attachmentIds: readonly string[],
  segments: readonly MessageSegment[] = [],
  contextType: 'dm' | 'group' = 'dm',
): Promise<{ baseHistory: readonly ModelMessage[]; modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const baseHistory = getCachedHistory(contextId)
  // Mirror the message-queue's logic: a group storageContextId with ':' is a thread.
  // isDm is true only for DM contexts; group main is {isThread:false, isDm:false}.
  const isDm = contextType === 'dm'
  const isThread = contextType === 'group' && contextId.includes(':')
  const { modelMessage, historyMessage } = await buildUserTurnMessages(
    contextId,
    chatUserId,
    modelName,
    userText,
    attachmentIds,
    segments,
    { isThread, isDm },
  )
  return { baseHistory, modelMessage, historyMessage }
}
