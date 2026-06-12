// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, mock } from 'bun:test'

import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'

describe('TelegramChatProvider.resolveUserId', () => {
  test('resolves numeric ID directly', async () => {
    const provider = new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'test' })

    const result = await provider.resolveUserId('123456789', { contextId: 'ctx', contextType: 'dm' })
    expect(result).toBe('123456789')
  })

  test('resolves @username via getChat API', async () => {
    const mockGetChat = mock(() => Promise.resolve({ id: 987654321 }))
    const provider = new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'test' })
    // @ts-expect-error - mock the bot.api.getChat
    provider.bot = { api: { getChat: mockGetChat } }

    const result = await provider.resolveUserId('@testuser', { contextId: 'ctx', contextType: 'dm' })
    expect(result).toBe('987654321')
    expect(mockGetChat).toHaveBeenCalledWith('@testuser')
  })

  test('resolves username without @ prefix via getChat API', async () => {
    const mockGetChat = mock(() => Promise.resolve({ id: 987654321 }))
    const provider = new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'test' })
    // @ts-expect-error - mock the bot.api.getChat
    provider.bot = { api: { getChat: mockGetChat } }

    const result = await provider.resolveUserId('testuser', { contextId: 'ctx', contextType: 'dm' })
    expect(result).toBe('987654321')
    expect(mockGetChat).toHaveBeenCalledWith('@testuser')
  })

  test('returns null for unresolvable username', async () => {
    const mockGetChat = mock(() => Promise.reject(new Error('user not found')))
    const provider = new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'test' })
    // @ts-expect-error - mock the bot.api.getChat
    provider.bot = { api: { getChat: mockGetChat } }

    const result = await provider.resolveUserId('@nonexistent', { contextId: 'ctx', contextType: 'dm' })
    expect(result).toBeNull()
  })
})
