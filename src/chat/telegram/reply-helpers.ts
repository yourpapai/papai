// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MessageEntity } from '@grammyjs/types/message.js'
import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'

import type { ButtonReplyOptions, DeferredDeliveryTarget, ReplyOptions } from '../types.js'
import { formatLlmOutput } from './format.js'

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

type TelegramMentionPrefix = {
  text: string
  entities: readonly TelegramEntity[]
}

type TelegramMentionTarget = {
  userId: number
  label: string
  firstName: string
}

const parseTelegramUserId = (value: string): number | null => {
  if (!/^\d+$/u.test(value)) {
    return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const getMentionLabel = (target: DeferredDeliveryTarget, mentionedUserId: string): string => {
  if (mentionedUserId === target.createdByUserId) {
    if (target.createdByUsername !== null) {
      return `@${target.createdByUsername}`
    }
    return 'you'
  }

  return 'user'
}

const normalizeMentionFirstName = (label: string): string => (label.startsWith('@') ? label.slice(1) : label)

export function buildTelegramMentionPrefix(target: DeferredDeliveryTarget): TelegramMentionPrefix {
  if (target.contextType !== 'group' || target.audience !== 'personal') {
    return { text: '', entities: [] }
  }

  const mentionTargets = target.mentionUserIds.flatMap<TelegramMentionTarget>((mentionedUserId) => {
    const userId = parseTelegramUserId(mentionedUserId)
    if (userId === null) {
      return []
    }

    const label = getMentionLabel(target, mentionedUserId)
    return [{ userId, label, firstName: normalizeMentionFirstName(label) }]
  })

  if (mentionTargets.length === 0) {
    return { text: '', entities: [] }
  }

  const text = `${mentionTargets.map((mention) => mention.label).join(' ')} `
  const mentionData = mentionTargets.reduce<{
    offset: number
    entities: readonly TelegramEntity[]
  }>(
    (acc, mention) => {
      const entity: TelegramEntity = {
        offset: acc.offset,
        length: mention.label.length,
        type: 'text_mention',
        user: {
          id: mention.userId,
          is_bot: false,
          first_name: mention.firstName,
        },
      }
      return {
        offset: acc.offset + mention.label.length + 1,
        entities: [...acc.entities, entity],
      }
    },
    { offset: 0, entities: [] },
  )

  return { text, entities: mentionData.entities }
}

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

/** Minimal context surface {@link sendFormattedReply} needs — just the message reply method. */
export type ReplyCapableContext = { reply: (text: string, other?: Record<string, unknown>) => Promise<unknown> }

/** Sent-message fields needed to build a detached prompt handle: chat id and message id. */
export type SentButtonMessage = { message_id: number; chat: { id: number } }
/** Minimal context surface {@link sendButtonReply} needs — reply returning a SentButtonMessage. */
export type ButtonReplyCapableContext = {
  reply: (text: string, other?: Record<string, unknown>) => Promise<SentButtonMessage>
}

export async function sendFormattedReply(
  ctx: ReplyCapableContext,
  markdown: string,
  buildReplyParams: ReplyParamsBuilder,
  options: ReplyOptions | undefined,
): Promise<void> {
  const formatted = formatLlmOutput(markdown)
  const replyParameters = options === undefined ? buildReplyParams() : buildReplyParams(options)
  await ctx.reply(formatted.text, {
    entities: formatted.entities,
    reply_parameters: replyParameters,
    ...(options?.disableLinkPreview === true ? { link_preview_options: { is_disabled: true } } : {}),
  })
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
