// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MessageEntity } from '@grammyjs/types/message.js'
import type { Context } from 'grammy'

import type { ContextType } from '../../src/chat/types.js'
import { logger } from '../../src/logger.js'
import { cacheMessage } from '../../src/message-cache/index.js'
import { createForumTopicIfNeeded } from './forum-topic-helpers.js'
import { extractReplyContext } from './reply-context-helpers.js'

const log = logger.child({ scope: 'chat:telegram:message-extraction' })

export interface ContextInfo {
  id: number
  contextId: string
  contextType: ContextType
  text: string
  entities: MessageEntity[] | undefined
  isMentioned: boolean
}

export interface MessageIds {
  messageIdStr: string | undefined
  replyToMessageIdStr: string | undefined
  replyToMessageText: string | undefined
  quoteText: string | undefined
}

export interface MinimalContext {
  from?: { id?: number; username?: string } | undefined
  chat?: { id?: number; type?: string } | undefined
  message?: {
    text?: string
    caption?: string
    entities?: MessageEntity[]
    caption_entities?: MessageEntity[]
    message_id?: number
    reply_to_message?: { message_id?: number; text?: string }
    quote?: { text?: string }
    message_thread_id?: number
  }
}

export function extractContextInfo(
  ctx: MinimalContext,
  isBotMentionedFn: (text: string, entities?: MessageEntity[]) => boolean,
): ContextInfo | null {
  const id = ctx.from?.id
  if (id === undefined) return null

  const chatType = ctx.chat?.type
  const isGroup = chatType === 'group' || chatType === 'supergroup' || chatType === 'channel'
  const contextId = String(ctx.chat?.id ?? id)
  const contextType: ContextType = isGroup ? 'group' : 'dm'
  const text = ctx.message?.text ?? ctx.message?.caption ?? ''
  const entities = ctx.message?.entities ?? ctx.message?.caption_entities
  const isMentioned = isBotMentionedFn(text, entities)

  return { id, contextId, contextType, text, entities, isMentioned }
}

export function extractMessageIds(ctx: MinimalContext): MessageIds {
  const messageId = ctx.message?.message_id
  const messageIdStr = messageId === undefined ? undefined : String(messageId)
  const replyToMessageId = ctx.message?.reply_to_message?.message_id
  const replyToMessageIdStr = replyToMessageId === undefined ? undefined : String(replyToMessageId)
  const replyToMessageText = ctx.message?.reply_to_message?.text
  const quoteText = ctx.message?.quote?.text

  return { messageIdStr, replyToMessageIdStr, replyToMessageText, quoteText }
}

export function logMessageExtraction(
  id: number,
  contextId: string,
  messageIdStr: string | undefined,
  replyToMessageIdStr: string | undefined,
  replyToMessageText: string | undefined,
  quoteText: string | undefined,
): void {
  const hasReply = replyToMessageIdStr !== undefined
  const hasQuote = quoteText !== undefined && quoteText !== ''
  log.debug(
    {
      userId: id,
      contextId,
      messageId: messageIdStr,
      hasReply,
      replyToMessageId: replyToMessageIdStr,
      replyToMessageTextLength: replyToMessageText?.length ?? 0,
      replyToMessageTextPreview: replyToMessageText?.slice(0, 100),
      hasQuote,
      quoteTextLength: quoteText?.length ?? 0,
      quoteTextPreview: quoteText?.slice(0, 100),
    },
    'Extracting Telegram message with reply/quote data',
  )
}

export interface CacheContext {
  from?: { username?: string } | undefined
}

export function cacheTelegramMessage(
  ctx: CacheContext,
  id: number,
  contextId: string,
  messageIdStr: string | undefined,
  text: string,
  replyToMessageIdStr: string | undefined,
): void {
  if (messageIdStr !== undefined) {
    cacheMessage({
      messageId: messageIdStr,
      contextId,
      authorId: String(id),
      authorUsername: ctx.from?.username ?? undefined,
      text,
      replyToMessageId: replyToMessageIdStr,
      timestamp: Date.now(),
    })
  }
}

export function resolveThreadId(
  ctx: Context,
  isMentioned: boolean,
  contextType: ContextType,
  api: {
    getChat: (chatId: number) => Promise<unknown>
    createForumTopic: (chatId: number, name: string) => Promise<{ message_thread_id: number }>
  },
): Promise<string | undefined> | string | undefined {
  if (isMentioned && contextType === 'group') {
    return createForumTopicIfNeeded(ctx, api)
  }
  if (ctx.message?.message_thread_id !== undefined) {
    return String(ctx.message.message_thread_id)
  }
  return undefined
}

export { extractReplyContext, createForumTopicIfNeeded }
