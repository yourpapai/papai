// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { IncomingMessage, ReplyFn } from '../types.js'
import type { DispatchableMessage } from './client-factory.js'
import { CHANNEL_TYPE_DM, mapDiscordMessage } from './map-message.js'
import { isBotMentioned } from './mention-helpers.js'
import { buildDiscordReplyContext } from './reply-context.js'
import { createDiscordReplyFn } from './reply-helpers.js'

const log = logger.child({ scope: 'chat:discord' })

/**
 * Determine if an unmentioned group message is a reply to the bot's own message.
 * Skips the fetch when the bot is already mentioned (passes the group filter regardless)
 * or when the message is in a DM channel.
 */
export async function resolveIsReplyToBot(
  message: DispatchableMessage,
  botId: string,
  mentioned: boolean,
): Promise<boolean> {
  if (message.reference?.messageId === undefined) return false
  if (message.channel.type === CHANNEL_TYPE_DM) return false
  if (mentioned) return false
  const messages = message.channel.messages
  if (messages === undefined) return false
  try {
    const parent = await messages.fetch(message.reference.messageId)
    return parent.author.id === botId
  } catch (error: unknown) {
    log.warn(
      {
        messageId: message.reference.messageId,
        error: error instanceof Error ? error.message : String(error),
      },
      'failed to fetch parent message for reply-to-bot detection',
    )
    return false
  }
}

/** Result of preparing a Discord message for handler dispatch. */
export type PreparedDispatch = {
  readonly mapped: IncomingMessage
  readonly reply: ReplyFn
}

/**
 * Shared pre-dispatch mapping for incoming Discord messages (create + edit).
 * Returns null when the message should be ignored (bot author, unsupported type,
 * unmentioned group message, etc.).
 */
export async function prepareDiscordDispatch(
  message: DispatchableMessage,
  botId: string,
  platformInstanceId: string,
): Promise<PreparedDispatch | null> {
  const mentioned = isBotMentioned(message.mentions, botId, 'group')
  const isReplyToBot = await resolveIsReplyToBot(message, botId, mentioned)
  const mapped = mapDiscordMessage(message, botId, platformInstanceId, isReplyToBot)
  if (mapped === null) return null
  const reply = createDiscordReplyFn({
    channel: message.channel,
    replyToMessageId: mapped.messageId,
  })
  return { mapped, reply }
}

/** Populate `mapped.replyContext` when the channel exposes a message cache. */
export async function attachDiscordReplyContext(message: DispatchableMessage, mapped: IncomingMessage): Promise<void> {
  if (message.channel.messages === undefined) return
  mapped.replyContext = await buildDiscordReplyContext(
    {
      reference: message.reference,
      channel: { id: message.channel.id, messages: message.channel.messages },
    },
    mapped.contextId,
  )
}
