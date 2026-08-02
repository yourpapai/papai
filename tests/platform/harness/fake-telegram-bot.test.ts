// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createFakeTelegramBot, type CallbackContext } from './fake-telegram-bot.js'

type Fake = ReturnType<typeof createFakeTelegramBot>

const callbackContext = (data: string): CallbackContext => ({
  callbackQuery: {
    id: 'cb-1',
    from: { id: 42, is_bot: false, first_name: 'Ada' },
    chat_instance: '0',
    data,
  },
  from: { id: 42, is_bot: false, first_name: 'Ada' },
  chat: { id: -100, type: 'group', title: 'g' },
  me: {
    id: 1,
    is_bot: true,
    first_name: 'Papai',
    username: 'papai',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  },
  answerCallbackQuery: (): Promise<true> => Promise.resolve(true),
})

describe('fake Telegram bot', () => {
  test('queues callback-query handlers and records callback answers', async () => {
    const fake: Fake = createFakeTelegramBot({
      getChatMember: () => Promise.resolve({ status: 'member' }),
    })
    const received: Array<string | undefined> = []
    fake.bot.on('callback_query:data', async (ctx) => {
      received.push(ctx.callbackQuery?.data)
      await ctx.answerCallbackQuery({ text: 'saved' })
    })

    fake.emitCallback(callbackContext('perm:a:prompt-1'))
    expect(received).toEqual([])
    await fake.flush()

    expect(received).toEqual(['perm:a:prompt-1'])
    expect(fake.callbackAnswers()).toEqual([{ text: 'saved' }])
    fake.assertClean()
  })

  test('assertClean fails while a callback handler is pending and passes after drain and stop', async () => {
    const fake: Fake = createFakeTelegramBot({
      getChatMember: () => Promise.resolve({ status: 'member' }),
    })
    let resolveHandler: (() => void) | undefined
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve
    })
    fake.bot.on('callback_query:data', () => handlerPromise)

    fake.emitCallback(callbackContext('perm:a:prompt-2'))
    expect(() => fake.assertClean()).toThrow()

    const flushPromise = fake.flush()
    expect(() => fake.assertClean()).toThrow()

    resolveHandler?.()
    await flushPromise

    expect(fake.callbackAnswers()).toEqual([])
    await fake.bot.stop()
    fake.assertClean()
  })

  test('uses a plain structural bot without constructing grammY', () => {
    const fake = createFakeTelegramBot({ getChatMember: () => Promise.resolve({ status: 'member' }) })

    expect(Object.getPrototypeOf(fake.bot)).toBe(Object.prototype)
    fake.assertClean()
  })

  test('records numeric membership lookup and exposes no polling timer', async () => {
    const fake = createFakeTelegramBot({ getChatMember: () => Promise.resolve({ status: 'member' }) })

    await fake.bot.api.getChatMember(-100, 42)

    expect(fake.membershipCalls()).toEqual([[-100, 42]])
    expect(fake.pollingTimer()).toBeNull()
    fake.assertClean()
  })

  test('returns caller-selected membership rejection and has idempotent cleanup', async () => {
    const fake = createFakeTelegramBot({ getChatMember: () => Promise.reject(new Error('Telegram unavailable')) })

    await expect(fake.bot.api.getChatMember(-100, 42)).rejects.toThrow('Telegram unavailable')
    await fake.bot.stop()
    await fake.bot.stop()
    fake.assertClean()
    fake.assertClean()
  })

  test('tracks factory lifecycle and fails cleanup while polling is active', async () => {
    const fake = createFakeTelegramBot({ getChatMember: () => Promise.resolve({ status: 'member' }) })
    let startedUsername: string | undefined

    const bot = fake.factory('telegram-test-token')
    await bot.start({
      onStart: (botInfo) => {
        startedUsername = botInfo.username
      },
    })

    expect(startedUsername).toBe('papai')
    expect(fake.pollingTimer()).not.toBeNull()
    expect(() => fake.assertClean()).toThrow('still polling')

    await bot.stop()
    expect(fake.pollingTimer()).toBeNull()
    fake.assertClean()
  })
})
