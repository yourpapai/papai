// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:telegram' })

/** Cache for forum status per chatId (in-memory, session-scoped) */
const forumStatusCache = new Map<number, boolean>()

/**
 * Clear the forum status cache. Used for testing.
 * @internal
 */
export function _clearForumStatusCache(): void {
  forumStatusCache.clear()
}

/** Subset of Context properties that createForumTopicIfNeeded uses */
export type ForumTopicContext = {
  chat?: { type: string; id: number }
  message?: { message_thread_id?: number }
  from?: { username?: string }
}

/**
 * Creates a new forum topic when bot is mentioned in main chat of a forum group.
 * Returns threadId if topic created or already in thread, undefined otherwise.
 */
export async function createForumTopicIfNeeded(
  ctx: ForumTopicContext,
  api: {
    getChat: (chatId: number) => Promise<unknown>
    createForumTopic: (chatId: number, name: string) => Promise<{ message_thread_id: number }>
  },
): Promise<string | undefined> {
  // Already in a thread/topic
  const existingThreadId = ctx.message?.message_thread_id
  if (existingThreadId !== undefined) {
    return String(existingThreadId)
  }

  const chat = ctx.chat
  if (chat?.type !== 'supergroup') return undefined

  // Check cache first, then API if needed
  let isForum = forumStatusCache.get(chat.id)
  if (isForum === undefined) {
    const rawChatInfo = await api.getChat(chat.id)
    const chatInfo = typeof rawChatInfo === 'object' && rawChatInfo !== null ? rawChatInfo : {}
    isForum = 'is_forum' in chatInfo && chatInfo.is_forum === true
    forumStatusCache.set(chat.id, isForum)
  }

  if (!isForum) return undefined

  try {
    const username = ctx.from?.username ?? 'user'
    const topic = await api.createForumTopic(chat.id, `Question from @${username}`)
    log.info({ threadId: topic.message_thread_id, chatId: chat.id }, 'Created forum topic')
    return String(topic.message_thread_id)
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), chatId: chat.id },
      'Failed to create forum topic',
    )
    return undefined
  }
}
