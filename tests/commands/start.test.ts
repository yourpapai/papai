// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler, ReplyFn } from '../../src/chat/types.js'
import { registerStartCommand } from '../../src/commands/start.js'
import { getConfigValue } from '../../src/config.js'
import { createMockChatWithCommandHandlers, mockLogger, setupTestDb } from '../utils/test-helpers.js'

/** Reply capturing `buttons` and `formatted` calls. */
function createCapturingReply(): {
  reply: ReplyFn
  buttonCalls: Array<{ content: string; buttons: unknown[] }>
  formattedCalls: string[]
} {
  const buttonCalls: Array<{ content: string; buttons: unknown[] }> = []
  const formattedCalls: string[] = []
  const reply = {
    text: (): Promise<void> => Promise.resolve(),
    formatted: (content: string): Promise<void> => {
      formattedCalls.push(content)
      return Promise.resolve()
    },
    file: (): Promise<void> => Promise.resolve(),
    typing: (): void => {},
    buttons: (content: string, options: { buttons?: unknown[] }): Promise<undefined> => {
      buttonCalls.push({ content, buttons: options.buttons ?? [] })
      return Promise.resolve(undefined)
    },
  }
  return { reply, buttonCalls, formattedCalls }
}

describe('start command', () => {
  let handler: CommandHandler | null = null
  const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    registerStartCommand(mockChat)
    handler = commandHandlers.get('start') ?? null
  })

  test('authorized user gets the welcome message', async () => {
    let captured: string | null = null
    const reply = {
      text: (): Promise<void> => Promise.resolve(),
      formatted: (content: string): Promise<void> => {
        captured = content
        return Promise.resolve()
      },
      file: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      buttons: (): Promise<undefined> => Promise.resolve(undefined),
    }
    const msg = {
      user: { id: 'u1', username: 'user', isAdmin: false },
      contextId: 'u1',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
      commandMatch: 'start',
      isMentioned: false,
    }
    await handler!(msg, reply, { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u1' })
    expect(captured).not.toBeNull()
    expect(captured!).toContain('Welcome')
    expect(captured!).toContain('/config')
  })

  test('first /start from a context with no stored language posts the picker and sets language_prompted', async () => {
    const { reply, buttonCalls } = createCapturingReply()
    const msg = {
      user: { id: 'u3', username: 'user', isAdmin: false },
      contextId: 'u3',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
      commandMatch: 'start',
      isMentioned: false,
    }
    await handler!(msg, reply, { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u3' })
    expect(buttonCalls).toHaveLength(1)
    expect(buttonCalls[0]!.buttons).toEqual([
      { text: 'English', callbackData: 'lang:en' },
      { text: 'Русский', callbackData: 'lang:ru' },
    ])
    expect(getConfigValue('u3', 'language_prompted')).toBe('1')
  })

  test('second /start does not re-post the picker but still welcomes', async () => {
    const first = createCapturingReply()
    const second = createCapturingReply()
    const msg = {
      user: { id: 'u4', username: 'user', isAdmin: false },
      contextId: 'u4',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
      commandMatch: 'start',
      isMentioned: false,
    }
    const auth = { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u4' }
    await handler!(msg, first.reply, auth)
    await handler!(msg, second.reply, auth)
    expect(first.buttonCalls).toHaveLength(1)
    expect(second.buttonCalls).toHaveLength(0)
    expect(second.formattedCalls).toHaveLength(1)
    expect(second.formattedCalls[0]!).toContain('Welcome')
  })

  test('unauthorized user gets the rejection message', async () => {
    let captured: string | null = null
    const reply = {
      text: (content: string): Promise<void> => {
        captured = content
        return Promise.resolve()
      },
      formatted: (): Promise<void> => Promise.resolve(),
      file: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      buttons: (): Promise<undefined> => Promise.resolve(undefined),
    }
    const msg = {
      user: { id: 'u2', username: 'user', isAdmin: false },
      contextId: 'u2',
      contextType: 'dm' as const,
      text: '/start',
      platformInstanceId: 'test-instance',
      commandMatch: 'start',
      isMentioned: false,
    }
    await handler!(msg, reply, { allowed: false, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u2' })
    expect(captured).not.toBeNull()
    expect(captured!).toContain('not authorized')
  })
})
