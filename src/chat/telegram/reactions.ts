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

/** Maps our canonical status emoji (kept in kv and passed by callers) to a Telegram-valid
 *  reaction — `setMessageReaction` only accepts a fixed ~70-emoji set and 4 of our 5 canonical
 *  emoji aren't in it. Only the Telegram API call is translated; the kv/caller side still tracks
 *  the canonical emoji. */
const TG_REACTION: Record<string, string> = { '⏳': '👨‍💻', '👀': '👀', '✅': '🎉', '❌': '👎', '🚫': '🤷' }

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
    const tgEmoji = emoji === null ? null : (TG_REACTION[emoji] ?? emoji)
    await api.setMessageReaction(
      chatId,
      mid,
      tgEmoji === null ? [] : [{ type: 'emoji', emoji: asReactionEmoji(tgEmoji) }],
    )
    return true
  } catch (error: unknown) {
    log.warn(
      { messageId, error: error instanceof Error ? error.message : String(error) },
      'Telegram setReaction failed',
    )
    return false
  }
}
