// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { DispatchableMessage } from '../../../src/chat/discord/client-factory.js'
import {
  attachDiscordReplyContext,
  prepareDiscordDispatch,
  resolveIsReplyToBot,
} from '../../../src/chat/discord/dispatch-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('dispatch-helpers', () => {
  mockLogger()

  const baseMessage = {
    id: 'm1',
    author: { id: 'u1', username: 'alice', bot: false },
    content: 'hello',
    channel: {
      id: 'dm-1',
      type: 1,
      send: (): Promise<{ id: string; edit: () => Promise<void>; delete: () => Promise<void> }> =>
        Promise.resolve({
          id: 'o',
          edit: (): Promise<void> => Promise.resolve(),
          delete: (): Promise<void> => Promise.resolve(),
        }),
      sendTyping: (): Promise<void> => Promise.resolve(),
    },
    mentions: { has: (): boolean => false },
    reference: null,
    type: 0,
  } satisfies DispatchableMessage

  test('prepareDiscordDispatch returns mapped message + reply for DMs', async () => {
    const result = await prepareDiscordDispatch(baseMessage, 'bot-1', 'discord-default')
    expect(result).not.toBeNull()
    expect(result?.mapped.text).toBe('hello')
    expect(result?.mapped.contextType).toBe('dm')
    expect(typeof result?.reply.text).toBe('function')
  })

  test('prepareDiscordDispatch returns null for bot-authored messages', async () => {
    const botMessage: DispatchableMessage = {
      ...baseMessage,
      author: { id: 'bot-1', username: 'bot', bot: true },
    }
    const result = await prepareDiscordDispatch(botMessage, 'bot-1', 'discord-default')
    expect(result).toBeNull()
  })

  test('resolveIsReplyToBot returns false for DM channel', async () => {
    const result = await resolveIsReplyToBot({ ...baseMessage, reference: { messageId: 'parent' } }, 'bot-1', false)
    expect(result).toBe(false)
  })

  test('attachDiscordReplyContext is a no-op when channel has no message cache', async () => {
    const result = await prepareDiscordDispatch(baseMessage, 'bot-1', 'discord-default')
    expect(result).not.toBeNull()
    await attachDiscordReplyContext(baseMessage, result!.mapped)
    expect(result!.mapped.replyContext).toBeUndefined()
  })
})
