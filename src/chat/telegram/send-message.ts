// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { DeferredDeliveryTarget } from '../types.js'
import type { TelegramBotApiLike } from './bot-factory.js'
import { chunkForTelegram, sliceTelegramEntities } from './chunking.js'
import { formatLlmOutput } from './format.js'
import { buildTelegramMentionPrefix } from './mention-prefix.js'
import { shiftTelegramEntity } from './reply-helpers.js'

const log = logger.child({ scope: 'telegram:send-message' })

type DeferredChunkState = { index: number; chunkStart: number; sent: number; lastError?: Error }

/**
 * Deliver a proactive markdown answer to a Telegram chat. The formatted text is
 * chunked against the platform limit; the personal-group mention prefix rides
 * the first chunk only (its entities as-is there, formatted entities windowed
 * per chunk). A failed chunk logs a warn and the remaining chunks still send;
 * when no chunk is delivered the last error propagates so delivery-accounting
 * callers (deferred poller) keep their prompts due for the next poll.
 */
export async function sendTelegramMessage(
  api: Pick<TelegramBotApiLike, 'sendMessage'>,
  target: DeferredDeliveryTarget,
  markdown: string,
): Promise<void> {
  const chatId = parseInt(target.contextId, 10)
  const mentionPrefix = buildTelegramMentionPrefix(target)
  const formatted = formatLlmOutput(markdown)
  const full = `${mentionPrefix.text}${formatted.text}`
  const chunks = chunkForTelegram(full)
  const threadOptions: { message_thread_id?: number } =
    target.contextType === 'group' && target.threadId !== null
      ? { message_thread_id: parseInt(target.threadId, 10) }
      : {}
  const sendChunk = (state: DeferredChunkState, chunk: string): Promise<DeferredChunkState> => {
    const chunkStart = state.chunkStart
    const chunkEnd = chunkStart + chunk.length
    const next: DeferredChunkState = { ...state, index: state.index + 1, chunkStart: chunkEnd }
    const options: Parameters<TelegramBotApiLike['sendMessage']>[2] = {
      entities: [
        // The mention prefix rides the first chunk only, its entities as-is.
        ...(state.index === 0 ? mentionPrefix.entities : []),
        // Formatted entities map into full-text coordinates (prefix shift),
        // then window onto this chunk.
        ...sliceTelegramEntities(
          formatted.entities.map((entity) => shiftTelegramEntity(entity, mentionPrefix.text.length)),
          chunkStart,
          chunkEnd,
        ),
      ],
      ...threadOptions,
    }
    return api.sendMessage(chatId, chunk, options).then(
      () => ({ ...next, sent: state.sent + 1 }),
      (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        log.warn({ index: state.index, total: chunks.length, error: err.message }, 'Telegram chunk send failed')
        return { ...next, lastError: err }
      },
    )
  }
  const finalState = await chunks.reduce<Promise<DeferredChunkState>>(
    (prev, chunk) => prev.then((state) => sendChunk(state, chunk)),
    Promise.resolve({ index: 0, chunkStart: 0, sent: 0 }),
  )
  if (finalState.sent === 0) throw finalState.lastError ?? new Error('Telegram chunked send delivered nothing')
}
