// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyContext } from '../../src/chat/types.js'
import { logger } from '../../src/logger.js'
import { getCachedMessage } from '../../src/message-cache/index.js'
import { buildReplyContextChain } from '../../src/reply-context.js'

const log = logger.child({ scope: 'chat:telegram:reply-context' })

/** Minimal interface for extractReplyContext input. Matches grammy Context structure. */
interface ExtractReplyContextInput {
  message?: {
    message_id?: number
    text?: string
    message_thread_id?: number
    reply_to_message?: {
      message_id?: number
      from?: { id?: number; username?: string } | undefined
      text?: string
    }
    quote?: { text?: string; is_manual?: boolean }
  }
}

/** Extract reply context from a Telegram message. Exported for testing. */
export function extractReplyContext(ctx: ExtractReplyContextInput, contextId: string): ReplyContext | undefined {
  const replyToMessage = ctx.message?.reply_to_message
  const replyToMessageId = replyToMessage?.message_id
  if (replyToMessage === undefined || replyToMessageId === undefined) return undefined

  const idStr = String(replyToMessageId)
  const quote = ctx.message?.quote
  const { chain, chainSummary } = buildReplyContextChain(contextId, idStr)
  const fromId = replyToMessage.from?.id
  const threadId = ctx.message?.message_thread_id

  const hasQuote = quote?.text !== undefined && quote.text !== ''
  const isManualQuote = quote?.is_manual === true
  const cached = getCachedMessage(contextId, idStr)
  const resolvedText = cached?.text ?? replyToMessage.text
  const quoteLength = quote?.text?.length ?? 0
  const quotedTextTruncated = isManualQuote && quoteLength >= 1024
  const fullMessageLength = resolvedText?.length ?? 0

  log.debug(
    {
      contextId,
      replyToMessageId: idStr,
      authorId: fromId,
      authorUsername: replyToMessage.from?.username ?? null,
      fullMessageLength,
      hasQuote,
      quoteLength,
      quotePreview: hasQuote ? quote.text?.slice(0, 100) : undefined,
      fullMessagePreview: replyToMessage.text?.slice(0, 100),
      chainLength: chain?.length ?? 0,
      hasChainSummary: chainSummary !== undefined && chainSummary !== '',
    },
    'Extracted reply context from Telegram message',
  )

  return {
    messageId: idStr,
    authorId: fromId === undefined ? undefined : String(fromId),
    authorUsername: replyToMessage.from?.username ?? null,
    text: resolvedText,
    quotedText: quote?.text,
    quotedTextTruncated: quotedTextTruncated || undefined,
    threadId: threadId === undefined ? undefined : String(threadId),
    chain,
    chainSummary,
  }
}
