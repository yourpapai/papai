// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleAuthorizedMessage } from '../../src/bot-message-handler.js'
import type { BotDeps } from '../../src/bot-message-handler.js'
import { maybePostLanguagePicker } from '../../src/chat/language-picker.js'
import type { AuthorizationResult, ChatCapability, IncomingMessage, ReplyFn } from '../../src/chat/types.js'
import { getConfigValue, setConfigValue } from '../../src/config.js'
import {
  createMockChat,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

const CONFIG_CTX = 'ctx-lang'
const STORAGE_CTX = 'ctx-lang'

const auth = (overrides?: Partial<AuthorizationResult>): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: STORAGE_CTX,
  configContextId: CONFIG_CTX,
  ...overrides,
})

const msg = (overrides?: Partial<IncomingMessage>): IncomingMessage => ({
  user: { id: 'u1', username: 'user', isAdmin: false },
  contextId: CONFIG_CTX,
  contextType: 'dm',
  text: 'hello',
  platformInstanceId: 'test-instance',
  isMentioned: false,
  messageId: 'm1',
  ...overrides,
})

/** Reply capturing `buttons` calls (content + options). */
function createButtonCapturingReply(): { reply: ReplyFn; buttonCalls: Array<{ content: string; buttons: unknown[] }> } {
  const buttonCalls: Array<{ content: string; buttons: unknown[] }> = []
  const base = createMockReply()
  const reply: ReplyFn = {
    ...base.reply,
    buttons: (content: string, options: { buttons?: unknown[] }): Promise<undefined> => {
      buttonCalls.push({ content, buttons: options.buttons ?? [] })
      return Promise.resolve(undefined)
    },
  }
  return { reply, buttonCalls }
}

describe('maybePostLanguagePicker', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  test('a context with no stored language gets a two-button picker and language_prompted is set', async () => {
    const chat = createMockChat()
    const { reply, buttonCalls } = createButtonCapturingReply()

    const posted = await maybePostLanguagePicker(chat, msg(), reply, auth())

    expect(posted).toBe(true)
    expect(buttonCalls).toHaveLength(1)
    expect(buttonCalls[0]!.content).toBe('Choose the language I will talk to you in:')
    expect(buttonCalls[0]!.buttons).toEqual([
      { text: 'English', callbackData: 'lang:en' },
      { text: 'Русский', callbackData: 'lang:ru' },
    ])
  })

  test('language_prompted is set after posting, so a subsequent call does not re-ask', async () => {
    const chat = createMockChat()
    const { reply, buttonCalls } = createButtonCapturingReply()

    expect(await maybePostLanguagePicker(chat, msg(), reply, auth())).toBe(true)
    expect(await maybePostLanguagePicker(chat, msg(), reply, auth())).toBe(false)
    expect(buttonCalls).toHaveLength(1)
  })

  test('concurrent first messages post the picker at most once', async () => {
    const chat = createMockChat()
    const buttonCalls: Array<{ content: string; buttons?: unknown[] }> = []
    let releaseSend!: () => void
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    const base = createMockReply()
    const gatedReply: ReplyFn = {
      ...base.reply,
      buttons: (content: string, options: { buttons?: unknown[] }): Promise<undefined> => {
        buttonCalls.push({ content, buttons: options.buttons })
        return sendGate.then(() => undefined)
      },
    }

    const first = maybePostLanguagePicker(chat, msg(), gatedReply, auth())
    const second = maybePostLanguagePicker(chat, msg({ messageId: 'm2' }), gatedReply, auth())
    releaseSend()

    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(buttonCalls).toHaveLength(1)
  })

  test('a failed send rolls back language_prompted so a later message can re-ask', async () => {
    const chat = createMockChat()
    const base = createMockReply()
    const failingReply: ReplyFn = {
      ...base.reply,
      buttons: (): Promise<undefined> => Promise.reject(new Error('send failed')),
    }

    expect(await maybePostLanguagePicker(chat, msg(), failingReply, auth())).toBe(false)
    expect(getConfigValue(CONFIG_CTX, 'language_prompted')).toBeNull()

    const { reply, buttonCalls } = createButtonCapturingReply()
    expect(await maybePostLanguagePicker(chat, msg({ messageId: 'm2' }), reply, auth())).toBe(true)
    expect(buttonCalls).toHaveLength(1)
  })

  test('guests skip the picker', async () => {
    const chat = createMockChat()
    const { reply, buttonCalls } = createButtonCapturingReply()

    const posted = await maybePostLanguagePicker(chat, msg(), reply, auth({ isGuest: true }))

    expect(posted).toBe(false)
    expect(buttonCalls).toHaveLength(0)
    expect(getConfigValue(CONFIG_CTX, 'language_prompted')).toBeNull()
  })

  test('a buttonless platform skips the picker and does not set language_prompted', async () => {
    const chat = createMockChat({ capabilities: new Set<ChatCapability>([]) })
    const { reply, buttonCalls } = createButtonCapturingReply()

    const posted = await maybePostLanguagePicker(chat, msg(), reply, auth())

    expect(posted).toBe(false)
    expect(buttonCalls).toHaveLength(0)
  })

  test('a context with a stored language never sees the picker', async () => {
    setConfigValue(CONFIG_CTX, 'language', 'ru')
    const chat = createMockChat()
    const { reply, buttonCalls } = createButtonCapturingReply()

    const posted = await maybePostLanguagePicker(chat, msg(), reply, auth())

    expect(posted).toBe(false)
    expect(buttonCalls).toHaveLength(0)
  })

  test('an unauthorized actor is left to the caller (helper assumes allowed)', async () => {
    const chat = createMockChat()
    const { reply, buttonCalls } = createButtonCapturingReply()

    const posted = await maybePostLanguagePicker(chat, msg(), reply, auth({ allowed: false }))

    expect(posted).toBe(false)
    expect(buttonCalls).toHaveLength(0)
  })
})

describe('handleAuthorizedMessage picker trigger', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  const deps = (): BotDeps => ({
    processMessage: async (): Promise<void> => {},
    enqueueMessage: (): void => {},
  })

  test('the first authorized message from a context with no stored language posts the picker', async () => {
    const chat = createMockChat()
    const { reply, buttonCalls } = createButtonCapturingReply()

    await handleAuthorizedMessage(chat, msg(), reply, auth(), deps())

    expect(buttonCalls).toHaveLength(1)
    expect(buttonCalls[0]!.buttons).toEqual([
      { text: 'English', callbackData: 'lang:en' },
      { text: 'Русский', callbackData: 'lang:ru' },
    ])
  })

  test('a second message does not re-ask', async () => {
    const chat = createMockChat()
    const { reply, buttonCalls } = createButtonCapturingReply()

    await handleAuthorizedMessage(chat, msg(), reply, auth(), deps())
    await handleAuthorizedMessage(chat, msg({ messageId: 'm2' }), reply, auth(), deps())

    expect(buttonCalls).toHaveLength(1)
  })

  test('a buttonless platform never sees the picker on the message path', async () => {
    const chat = createMockChat({ capabilities: new Set<ChatCapability>([]) })
    const { reply, buttonCalls } = createButtonCapturingReply()

    await handleAuthorizedMessage(chat, msg(), reply, auth(), deps())

    expect(buttonCalls).toHaveLength(0)
  })
})
