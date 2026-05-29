// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { ContextType, IncomingMessage } from '../types.js'
import { isBotMentioned, stripBotMention } from './mention-helpers.js'

const log = logger.child({ scope: 'chat:discord:map' })

// Minimal structural type over discord.js Message to keep this module
// runtime-free of discord.js. Production code will pass a real Message
// object and the structural match will hold.
export type DiscordMessageLike = {
  id: string
  author: { id: string; username: string; bot: boolean }
  content: string
  channel: { id: string; type: number } & Partial<{ name: string }>
  mentions: { has: (id: string) => boolean }
  reference: Partial<{ messageId: string }> | null
  type: number
} & Partial<{ guild: { id: string; name: string } | null }>

// Discord.js ChannelType: DM = 1. Everything else maps to 'group'.
const CHANNEL_TYPE_DM = 1

// Discord.js MessageType values we accept. Default = 0, Reply = 19.
const ACCEPTED_MESSAGE_TYPES = new Set<number>([0, 19])

/** Map a Discord message to papai's IncomingMessage. Returns null if the message should be ignored. */
export function mapDiscordMessage(
  message: DiscordMessageLike,
  botId: string,
  _adminUserId: string,
  platformInstanceId: string,
): IncomingMessage | null {
  if (message.author.bot) {
    log.debug({ messageId: message.id, authorId: message.author.id }, 'Skipping bot-authored message')
    return null
  }
  if (!ACCEPTED_MESSAGE_TYPES.has(message.type)) {
    log.debug({ messageId: message.id, type: message.type }, 'Skipping unsupported message type')
    return null
  }

  const contextType: ContextType = message.channel.type === CHANNEL_TYPE_DM ? 'dm' : 'group'
  const contextId = contextType === 'dm' ? message.author.id : message.channel.id
  const mentioned = isBotMentioned(message.mentions, botId, contextType)

  if (contextType === 'group' && !mentioned) {
    return null
  }

  const text = stripBotMention(message.content, botId)
  const contextName = contextType === 'group' ? message.channel.name : undefined
  const guild = 'guild' in message ? message.guild : undefined
  const contextParentName = contextType === 'group' && guild !== undefined && guild !== null ? guild.name : undefined
  const replyToMessageId = message.reference === null ? undefined : message.reference.messageId

  return {
    user: {
      id: message.author.id,
      username: message.author.username.length > 0 ? message.author.username : null,
      isAdmin: false,
    },
    contextId,
    contextType,
    contextName,
    contextParentName,
    isMentioned: mentioned,
    text,
    platformInstanceId,
    messageId: message.id,
    replyToMessageId,
  }
}
