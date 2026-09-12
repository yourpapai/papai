// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MessageEntity } from '@grammyjs/types/message.js'
import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'

import { logger } from '../../logger.js'
import type { ButtonReplyOptions, ReplyOptions } from '../types.js'
import { chunkForTelegram, sliceTelegramEntities } from './chunking.js'
import { formatLlmOutput } from './format.js'

const log = logger.child({ scope: 'telegram:reply-helpers' })

type TelegramReplyParameters = { message_id: number } & Partial<{ message_thread_id: number }>

export type ReplyParamsBuilder = (...rest: [] | [ReplyOptions]) => TelegramReplyParameters | undefined

/** Subset of Context properties that createReplyParamsBuilder uses */
export type ReplyContext = Partial<{
  message: Partial<{ message_id: number; message_thread_id: number }>
}>

type ReplacementCallOptions = Partial<{
  entities: ReturnType<typeof formatLlmOutput>['entities']
  reply_markup: InlineKeyboard
}>

type TelegramEntity = ReturnType<typeof formatLlmOutput>['entities'][number]

export function shiftTelegramEntity(entity: TelegramEntity, offset: number): TelegramEntity {
  return {
    ...entity,
    offset: entity.offset + offset,
  }
}

const getTelegramMentionEntities = (entities: MessageEntity[] | undefined): MessageEntity[] => {
  if (entities === undefined) {
    return []
  }
  return entities
}

export function getTelegramUsername(username: string | undefined): string | null {
  if (username === undefined) {
    return null
  }
  return username
}

export function telegramIsBotMentioned(
  text: string,
  entities: MessageEntity[] | undefined,
  botUsername: string | null,
): boolean {
  if (botUsername === null) return false
  if (text.includes(`@${botUsername}`)) return true
  const entityList = getTelegramMentionEntities(entities)
  return entityList.some((e) => e.type === 'mention' && text.slice(e.offset, e.offset + e.length) === `@${botUsername}`)
}

export async function checkTelegramAdminStatus(
  ctx: Context,
  getChatAdministrators: (chatId: number) => Promise<Array<{ user: { id: number } }>>,
): Promise<boolean> {
  const chat = ctx.chat
  if (chat !== undefined && chat.type === 'private') return true
  if (chat === undefined || chat.id === undefined) return false
  try {
    const admins = await getChatAdministrators(chat.id)
    const from = ctx.from
    const fromId = from === undefined ? undefined : from.id
    return admins.some((admin) => admin.user.id === fromId)
  } catch {
    return false
  }
}

/** Subset of Context properties that replacement reply helpers use */
export type ReplacementReplyContext = {
  editMessageText: (text: string, ...rest: [] | [ReplacementCallOptions]) => Promise<unknown>
}

export function createReplyParamsBuilder(ctx: ReplyContext): ReplyParamsBuilder
export function createReplyParamsBuilder(ctx: ReplyContext, threadId: string | undefined): ReplyParamsBuilder
export function createReplyParamsBuilder(
  ctx: ReplyContext,
  ...threadRest: [] | [string | undefined]
): ReplyParamsBuilder {
  const threadId = threadRest[0]
  const message = ctx.message
  const messageId = message === undefined ? undefined : message.message_id
  const contextThreadId = message === undefined ? undefined : message.message_thread_id

  return (...optionRest: [] | [ReplyOptions]): TelegramReplyParameters | undefined => {
    const options = optionRest[0]
    const targetMessageId =
      options !== undefined && options.replyToMessageId !== undefined
        ? parseInt(options.replyToMessageId, 10)
        : messageId

    if (targetMessageId === undefined) return undefined

    let effectiveThreadId = contextThreadId
    if (options !== undefined && options.threadId !== undefined) {
      effectiveThreadId = parseInt(options.threadId, 10)
    }
    if (threadId !== undefined) {
      effectiveThreadId = parseInt(threadId, 10)
    }

    const replyParams: TelegramReplyParameters = {
      message_id: targetMessageId,
    }
    if (effectiveThreadId !== undefined) {
      replyParams.message_thread_id = effectiveThreadId
    }
    return replyParams
  }
}

export async function sendTextReply(
  ctx: Context,
  content: string,
  buildReplyParams: ReplyParamsBuilder,
  options: ReplyOptions | undefined,
): Promise<void> {
  const replyParameters = options === undefined ? buildReplyParams() : buildReplyParams(options)
  await ctx.reply(content, { reply_parameters: replyParameters })
}

/** Sent-message fields needed to build a detached prompt handle: chat id and message id. */
export type SentButtonMessage = { message_id: number; chat: { id: number } }
/** Narrowed reply context that preserves the returned message — lets sendButtonReply/sendFormattedReply capture it. */
export type ButtonReplyCapableContext = {
  reply: (text: string, other?: Record<string, unknown>) => Promise<SentButtonMessage>
}

export async function sendFormattedReply(
  ctx: ButtonReplyCapableContext,
  markdown: string,
  buildReplyParams: ReplyParamsBuilder,
  options: ReplyOptions | undefined,
): Promise<{ messageId: number; chatId: number }> {
  const formatted = formatLlmOutput(markdown)
  const replyParameters = options === undefined ? buildReplyParams() : buildReplyParams(options)
  const chunks = chunkForTelegram(formatted.text)

  type SentState = {
    index: number
    chunkStart: number
    last?: { messageId: number; chatId: number }
    lastError?: Error
  }
  const sendChunk = async (state: SentState, chunk: string): Promise<SentState> => {
    const chunkStart = state.chunkStart
    const chunkEnd = chunkStart + chunk.length
    const next: SentState = {
      index: state.index + 1,
      chunkStart: chunkEnd,
      last: state.last,
      lastError: state.lastError,
    }
    try {
      const sent = await ctx.reply(chunk, {
        entities: sliceTelegramEntities(formatted.entities, chunkStart, chunkEnd),
        reply_parameters: replyParameters,
        ...(options?.disableLinkPreview === true ? { link_preview_options: { is_disabled: true } } : {}),
      })
      return { ...next, last: { messageId: sent.message_id, chatId: sent.chat.id } }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      log.warn({ index: state.index, total: chunks.length, error: err.message }, 'Telegram chunk send failed')
      return { ...next, lastError: err }
    }
  }
  const finalState = await chunks.reduce<Promise<SentState>>(
    (prev, chunk) => prev.then((state) => sendChunk(state, chunk)),
    Promise.resolve({ index: 0, chunkStart: 0 }),
  )
  if (finalState.last === undefined) {
    throw finalState.lastError ?? new Error('Telegram chunked reply delivered nothing')
  }
  return finalState.last
}

export async function sendFileReply(
  ctx: Context,
  file: { content: Buffer | string; filename: string },
  buildReplyParams: ReplyParamsBuilder,
  options: ReplyOptions | undefined,
): Promise<void> {
  const { InputFile } = await import('grammy')
  const content = typeof file.content === 'string' ? Buffer.from(file.content, 'utf-8') : file.content
  const replyParameters = options === undefined ? buildReplyParams() : buildReplyParams(options)
  await ctx.replyWithDocument(new InputFile(content, file.filename), {
    reply_parameters: replyParameters,
  })
}

export function sendButtonReply(
  ctx: ButtonReplyCapableContext,
  content: string,
  buildReplyParams: ReplyParamsBuilder,
  options: ButtonReplyOptions,
): Promise<SentButtonMessage> {
  const keyboard = buildInlineKeyboard(options)
  const formatted = formatLlmOutput(content)
  return ctx.reply(formatted.text, {
    entities: formatted.entities,
    reply_markup: keyboard,
    reply_parameters: buildReplyParams(options),
  })
}

export async function sendReplacementTextReply(ctx: ReplacementReplyContext, content: string): Promise<void> {
  const formatted = formatLlmOutput(content)
  await ctx.editMessageText(formatted.text, {
    entities: formatted.entities,
    reply_markup: new InlineKeyboard([]),
  })
}

export async function sendReplacementButtonReply(
  ctx: ReplacementReplyContext,
  content: string,
  options: ButtonReplyOptions,
): Promise<void> {
  const formatted = formatLlmOutput(content)
  await ctx.editMessageText(formatted.text, {
    entities: formatted.entities,
    reply_markup: buildInlineKeyboard(options),
  })
}

function buildInlineKeyboard(options: ButtonReplyOptions): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  if (options.buttons !== undefined) {
    for (let i = 0; i < options.buttons.length; i += 2) {
      const btn1 = options.buttons[i]
      const btn2 = options.buttons[i + 1]
      if (btn1 !== undefined) {
        keyboard.text(btn1.text, btn1.callbackData)
      }
      if (btn2 !== undefined) {
        keyboard.text(btn2.text, btn2.callbackData)
      }
      keyboard.row()
    }
  }
  return keyboard
}
