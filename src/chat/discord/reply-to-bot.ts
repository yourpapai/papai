// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { DispatchableMessage } from './client-factory.js'
import { CHANNEL_TYPE_DM } from './map-message.js'

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
