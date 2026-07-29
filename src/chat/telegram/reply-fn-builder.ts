// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Context } from 'grammy'

import { logger } from '../../logger.js'
import type { ReplyFn, ReplyOptions, ReplyTarget, StatusHandle } from '../types.js'
import { formatLlmOutput } from './format.js'
import { buildTelegramPromptHandle, type TelegramBotEditApi } from './prompt-handle-builder.js'
import {
  createReplyParamsBuilder,
  type ReplyParamsBuilder,
  sendButtonReply,
  sendFileReply,
  sendFormattedReply,
  sendReplacementButtonReply,
  sendReplacementTextReply,
  sendTextReply,
} from './reply-helpers.js'

const log = logger.child({ scope: 'chat:telegram' })

const ignoreTelegramTypingError = (): null => null

export type CallbackAnswerState = { answered: boolean }

type TelegramReplyRef = { messageId: number; chatId: number }

const asTelegramReplyRef = (ref: unknown): TelegramReplyRef | undefined => {
  if (typeof ref !== 'object' || ref === null || !('messageId' in ref) || !('chatId' in ref)) {
    return undefined
  }
  const { messageId, chatId } = ref as Record<string, unknown>
  if (typeof messageId !== 'number' || typeof chatId !== 'number') return undefined
  return { messageId, chatId }
}

const buildTelegramEditReply =
  (api: TelegramBotEditApi) =>
  async (target: ReplyTarget, markdown: string): Promise<void> => {
    const ref = asTelegramReplyRef(target.ref)
    if (ref === undefined) return
    const formatted = formatLlmOutput(markdown)
    await api
      .editMessageText(ref.chatId, ref.messageId, formatted.text, { entities: formatted.entities })
      .catch(() => undefined)
  }

async function buildStatusHandle(
  ctx: Context,
  api: TelegramBotEditApi,
  initialText: string,
  replyParams: ReturnType<ReplyParamsBuilder>,
): Promise<StatusHandle | undefined> {
  const sent = await ctx.reply(initialText, { reply_parameters: replyParams }).catch((err: unknown) => {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to create status message')
    return undefined
  })
  if (sent === undefined) return undefined
  const statusChatId = sent.chat.id
  const statusMessageId = sent.message_id
  return {
    update: async (text: string): Promise<void> => {
      await api.editMessageText(statusChatId, statusMessageId, text).catch(() => undefined)
    },
    dismiss: async (): Promise<void> => {
      await api.deleteMessage(statusChatId, statusMessageId).catch(() => undefined)
    },
  }
}

function attachReplacementMethods(
  replyFn: ReplyFn,
  ctx: Context,
  callbackAnswerState: CallbackAnswerState | undefined,
): void {
  replyFn.replaceText = (content): Promise<void> => sendReplacementTextReply(ctx, content)
  replyFn.replaceButtons = (content, options): Promise<void> => sendReplacementButtonReply(ctx, content, options)
  replyFn.ephemeralConfirm = async (confirmText: string): Promise<void> => {
    await ctx
      .answerCallbackQuery({ text: confirmText })
      .then(() => {
        if (callbackAnswerState !== undefined) callbackAnswerState.answered = true
      })
      .catch((err: unknown) => {
        log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Failed to answer callback query')
      })
  }
}

/**
 * Build the ReplyFn for a Telegram context.
 * When allowReplacement is true, the replacement helpers (replaceText, replaceButtons, ephemeralConfirm)
 * are attached. Pass a callbackAnswerState to let ephemeralConfirm signal that the query was answered,
 * so the caller's safety-net can be skipped.
 */
export function buildTelegramReplyFn(
  ctx: Context,
  threadId: string | undefined,
  allowReplacement: boolean,
  api: TelegramBotEditApi,
  callbackAnswerState?: CallbackAnswerState,
): ReplyFn {
  const chat = ctx.chat
  const message = ctx.message
  const chatId = chat === undefined ? undefined : chat.id
  const messageId = message === undefined ? undefined : message.message_id
  const buildReplyParams = createReplyParamsBuilder(ctx, threadId)
  let lastReplyTarget: ReplyTarget | undefined
  const replyFn: ReplyFn = {
    text: (content: string, ...rest: [] | [ReplyOptions]) => sendTextReply(ctx, content, buildReplyParams, rest[0]),
    formatted: async (markdown: string, ...rest: [] | [ReplyOptions]) => {
      const sent = await sendFormattedReply(ctx, markdown, buildReplyParams, rest[0])
      lastReplyTarget = { platform: 'telegram', ref: sent }
    },
    file: (chatFile, ...rest: [] | [ReplyOptions]) => sendFileReply(ctx, chatFile, buildReplyParams, rest[0]),
    typing: () => {
      void ctx.replyWithChatAction('typing').catch(ignoreTelegramTypingError)
    },
    redactMessage: async (replacementText: string) => {
      if (chatId !== undefined && messageId !== undefined) {
        await api.editMessageText(chatId, messageId, replacementText).catch((err: unknown) => {
          log.warn(
            { chatId, messageId, error: err instanceof Error ? err.message : String(err) },
            'Failed to redact message',
          )
        })
      }
    },
    buttons: async (content: string, opts) => {
      const sent = await sendButtonReply(ctx, content, buildReplyParams, opts)
      return buildTelegramPromptHandle(api, sent.chat.id, sent.message_id)
    },
    createStatus: (initialText: string) => buildStatusHandle(ctx, api, initialText, buildReplyParams()),
    editReply: buildTelegramEditReply(api),
    lastReplyTarget: () => lastReplyTarget,
  }
  if (allowReplacement) {
    attachReplacementMethods(replyFn, ctx, callbackAnswerState)
  }
  return replyFn
}
