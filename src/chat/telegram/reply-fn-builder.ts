// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Context } from 'grammy'

import { logger } from '../../logger.js'
import type { ReplyFn, ReplyOptions } from '../types.js'
import { buildTelegramPromptHandle, type TelegramBotEditApi } from './prompt-handle-builder.js'
import {
  createReplyParamsBuilder,
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
  const replyFn: ReplyFn = {
    text: (content: string, ...rest: [] | [ReplyOptions]) => sendTextReply(ctx, content, buildReplyParams, rest[0]),
    formatted: (markdown: string, ...rest: [] | [ReplyOptions]) =>
      sendFormattedReply(ctx, markdown, buildReplyParams, rest[0]),
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
  }
  if (allowReplacement) {
    attachReplacementMethods(replyFn, ctx, callbackAnswerState)
  }
  return replyFn
}
