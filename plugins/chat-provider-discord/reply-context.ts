// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyContext } from '../../src/chat/types.js'
import { logger } from '../../src/logger.js'
import { buildReplyContextChain } from '../../src/reply-context.js'

const log = logger.child({ scope: 'chat:discord:reply-context' })

export type DiscordReplyMessageLike = {
  reference: { messageId?: string } | null
  channel: {
    id: string
    messages: {
      fetch: (id: string) => Promise<{
        id: string
        author: { id: string; username: string }
        content: string
      }>
    }
  }
}

/** Build a ReplyContext from a Discord message's reference, using a REST fetch for the parent. */
export async function buildDiscordReplyContext(
  message: DiscordReplyMessageLike,
  contextId: string,
): Promise<ReplyContext | undefined> {
  const refId = message.reference?.messageId
  if (refId === undefined) return undefined

  const { chain, chainSummary } = buildReplyContextChain(contextId, refId)

  try {
    const parent = await message.channel.messages.fetch(refId)
    return {
      messageId: refId,
      authorId: parent.author.id,
      authorUsername: parent.author.username,
      text: parent.content,
      chain,
      chainSummary,
    }
  } catch (error) {
    log.warn(
      { refId, error: error instanceof Error ? error.message : String(error) },
      'Failed to fetch Discord parent message',
    )
    return { messageId: refId, chain, chainSummary }
  }
}
