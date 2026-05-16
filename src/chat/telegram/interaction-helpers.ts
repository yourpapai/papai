// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextType, IncomingInteraction } from '../types.js'

export type TelegramInteractionContext = {
  from?: { id?: number; username?: string }
  chat?: { id?: number; type?: string }
  callbackQuery?: { data?: string; message?: { message_id?: number; message_thread_id?: number } }
}

function callbackMessageId(ctx: TelegramInteractionContext): string | undefined {
  const messageId = ctx.callbackQuery?.message?.message_id
  return messageId === undefined ? undefined : String(messageId)
}

function callbackThreadId(ctx: TelegramInteractionContext): string | undefined {
  const threadId = ctx.callbackQuery?.message?.message_thread_id
  return threadId === undefined ? undefined : String(threadId)
}

/**
 * Computes thread-scoped storage context ID matching getThreadScopedStorageContextId.
 * - DMs: userId
 * - Main chat: groupId
 * - Thread: groupId:threadId
 */
function computeStorageContextId(contextId: string, contextType: ContextType, threadId: string | undefined): string {
  if (contextType === 'dm') return contextId
  if (threadId === undefined) return contextId
  return `${contextId}:${threadId}`
}

export function buildTelegramInteraction(
  ctx: TelegramInteractionContext,
  isAdmin: boolean,
): IncomingInteraction | null {
  const callbackData = ctx.callbackQuery?.data ?? ''
  if (callbackData === '') return null

  const fromId = ctx.from?.id
  if (fromId === undefined) return null

  const userId = String(fromId)
  const contextId = String(ctx.chat?.id ?? userId)
  const contextType: ContextType = ctx.chat?.type === 'private' ? 'dm' : 'group'
  const threadId = callbackThreadId(ctx)

  return {
    kind: 'button',
    user: { id: userId, username: ctx.from?.username ?? null, isAdmin },
    contextId,
    contextType,
    storageContextId: computeStorageContextId(contextId, contextType, threadId),
    callbackData,
    messageId: callbackMessageId(ctx),
    threadId,
  }
}
