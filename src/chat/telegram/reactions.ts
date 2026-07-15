// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Api } from 'grammy'
import type { ReactionTypeEmoji } from 'grammy/types'

import { logger } from '../../logger.js'
import type { DeferredDeliveryTarget } from '../types.js'

const log = logger.child({ scope: 'chat:telegram:reactions' })

type TelegramReactionApi = Pick<Api, 'setMessageReaction'>

// grammy's type only enumerates the emoji Telegram currently supports for reactions; an emoji
// outside that set is rejected by the live API and caught as a best-effort failure below, never thrown.
const asReactionEmoji = (emoji: string): ReactionTypeEmoji['emoji'] => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return emoji as unknown as ReactionTypeEmoji['emoji']
}

/**
 * Sets or clears a Telegram reaction on an existing message. Telegram's `setMessageReaction`
 * REPLACES the whole reaction set, so `previousEmoji` is intentionally ignored: setting `emoji`
 * replaces the set with that single reaction, and `emoji: null` clears it via an empty array.
 * Best-effort: never throws, returns false on any failure or for a non-numeric `messageId`.
 */
export async function setTelegramReaction(
  api: TelegramReactionApi,
  target: DeferredDeliveryTarget,
  messageId: string,
  emoji: string | null,
): Promise<boolean> {
  const chatId = parseInt(target.contextId, 10)
  const mid = Number(messageId)
  if (!Number.isInteger(mid)) return false
  try {
    await api.setMessageReaction(chatId, mid, emoji === null ? [] : [{ type: 'emoji', emoji: asReactionEmoji(emoji) }])
    return true
  } catch (error: unknown) {
    log.warn(
      { messageId, error: error instanceof Error ? error.message : String(error) },
      'Telegram setReaction failed',
    )
    return false
  }
}
