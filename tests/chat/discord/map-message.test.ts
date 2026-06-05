// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { type DiscordMessageLike, mapDiscordMessage } from '../../../plugins/chat-provider-discord/map-message.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('mapDiscordMessage', () => {
  beforeEach(() => {
    mockLogger()
  })

  const botId = 'bot-snowflake'
  // adminId is used as the author id in the "does not mark admin users" test.
  const adminId = 'admin-snowflake'
  const platformInstanceId = 'discord-default'

  function makeMsg(...args: [] | [overrides: Partial<DiscordMessageLike>]): DiscordMessageLike {
    const overrides = args.length === 0 ? {} : args[0]
    return {
      id: 'msg-1',
      author: { id: 'user-1', username: 'alice', bot: false },
      content: 'hello',
      channel: { id: 'chan-1', type: 0, name: undefined },
      guild: undefined,
      mentions: { has: (id) => id === botId },
      reference: null,
      type: 0,
      ...overrides,
    }
  }

  test('maps a guild message that @mentions the bot', () => {
    const msg = makeMsg({ content: `<@${botId}> /help` })
    const result = mapDiscordMessage(msg, botId, platformInstanceId)
    expect(result).not.toBeNull()
    expect(result!.user.id).toBe('user-1')
    expect(result!.user.username).toBe('alice')
    expect(result!.user.isAdmin).toBe(false)
    expect(result!.contextType).toBe('group')
    expect(result!.contextId).toBe('chan-1')
    expect(result!.isMentioned).toBe(true)
    expect(result!.text).toBe('/help')
    expect(result!.messageId).toBe('msg-1')
  })

  test('maps a DM message', () => {
    const msg = makeMsg({
      channel: { id: 'dm-1', type: 1, name: undefined },
      content: 'what is the status?',
      mentions: { has: () => false },
    })
    const result = mapDiscordMessage(msg, botId, platformInstanceId)
    expect(result).not.toBeNull()
    expect(result!.contextType).toBe('dm')
    expect(result!.contextId).toBe('user-1')
    expect(result!.isMentioned).toBe(true)
    expect(result!.text).toBe('what is the status?')
  })

  test('does not mark admin users via ADMIN_USER_ID equality', () => {
    const msg = makeMsg({
      author: { id: adminId, username: 'admin', bot: false },
      content: `<@${botId}> hello`,
    })
    const result = mapDiscordMessage(msg, botId, platformInstanceId)
    expect(result).not.toBeNull()
    expect(result!.user.isAdmin).toBe(false)
  })

  test('returns null for bot-authored messages', () => {
    const msg = makeMsg({ author: { id: 'some-bot', username: 'other', bot: true } })
    expect(mapDiscordMessage(msg, botId, platformInstanceId)).toBeNull()
  })

  test('returns null for unsupported MessageType variants', () => {
    const msg = makeMsg({ type: 7 })
    expect(mapDiscordMessage(msg, botId, platformInstanceId)).toBeNull()
  })

  test('returns null for guild message that does not mention the bot', () => {
    const msg = makeMsg({ content: 'unrelated chatter', mentions: { has: () => false } })
    expect(mapDiscordMessage(msg, botId, platformInstanceId)).toBeNull()
  })

  test('preserves replyToMessageId from message.reference', () => {
    const msg = makeMsg({
      content: `<@${botId}> yep`,
      reference: { messageId: 'parent-msg-99' },
      type: 19,
    })
    const result = mapDiscordMessage(msg, botId, platformInstanceId)
    expect(result!.replyToMessageId).toBe('parent-msg-99')
  })

  test('maps Discord channel and guild names onto IncomingMessage metadata', () => {
    const mapped = mapDiscordMessage(
      {
        id: 'm1',
        author: { id: 'user-1', username: 'alice', bot: false },
        content: `<@${botId}> /help`,
        channel: { id: 'chan-1', type: 0, name: 'operations' },
        guild: { id: 'guild-1', name: 'Platform' },
        mentions: { has: (id: string) => id === botId },
        reference: null,
        type: 0,
      },
      botId,
      platformInstanceId,
    )

    expect(mapped).not.toBeNull()
    expect(mapped!.contextName).toBe('operations')
    expect(mapped!.contextParentName).toBe('Platform')
  })

  test('uses the provided platform instance ID', () => {
    const msg = makeMsg({ content: `<@${botId}> /help` })
    const result = mapDiscordMessage(msg, botId, 'discord-secondary')

    expect(result).not.toBeNull()
    expect(result!.platformInstanceId).toBe('discord-secondary')
  })
})
