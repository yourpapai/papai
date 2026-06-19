// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { PromptHandle } from '../prompt-handle.js'

const log = logger.child({ scope: 'chat:telegram' })

/** Minimal Telegram bot API surface needed to edit/delete a sent message. */
export type TelegramBotEditApi = {
  editMessageText(chatId: number, messageId: number, text: string, other?: Record<string, unknown>): Promise<unknown>
  deleteMessage(chatId: number, messageId: number): Promise<unknown>
}

/**
 * Build a detached {@link PromptHandle} for an already-sent Telegram message.
 * The handle edits (redacts) or deletes the message via the bot API.
 */
export function buildTelegramPromptHandle(
  api: TelegramBotEditApi,
  sentChatId: number,
  sentMessageId: number,
): PromptHandle {
  return {
    redact: async (promptText: string): Promise<void> => {
      await api
        .editMessageText(sentChatId, sentMessageId, promptText, { reply_markup: { inline_keyboard: [] } })
        .catch((err: unknown) => {
          log.warn(
            { sentChatId, sentMessageId, error: err instanceof Error ? err.message : String(err) },
            'Failed to redact prompt',
          )
        })
    },
    remove: async (): Promise<void> => {
      await api.deleteMessage(sentChatId, sentMessageId).catch((err: unknown) => {
        log.warn(
          { sentChatId, sentMessageId, error: err instanceof Error ? err.message : String(err) },
          'Failed to remove prompt',
        )
      })
    },
  }
}
