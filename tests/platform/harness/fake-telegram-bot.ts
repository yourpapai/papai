// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Bot } from 'grammy'

import type { TelegramBotFactory, TelegramBotLike } from '../../../src/chat/telegram/index.js'

export type FakeTelegramBotOptions = {
  getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>
}

export type FakeTelegramBot = {
  bot: TelegramBotLike
  factory: TelegramBotFactory
  membershipCalls(): readonly [number, number][]
  pollingTimer(): object | null
  assertClean(): void
}

export function createFakeTelegramBot(options: FakeTelegramBotOptions): FakeTelegramBot {
  const calls: Array<[number, number]> = []
  const bot = new Bot('fake-telegram-token')
  let pollingTimer: object | null = null

  Reflect.set(bot.api, 'getChatMember', (chatId: number, userId: number) => {
    calls.push([chatId, userId])
    return options.getChatMember(chatId, userId)
  })
  Reflect.set(bot, 'start', (startOptions?: { onStart?: (botInfo: { username: string }) => void }) => {
    pollingTimer = { owner: 'fake-telegram-poller' }
    startOptions?.onStart?.({ username: 'papai' })
    return Promise.resolve()
  })
  Reflect.set(bot, 'stop', () => {
    pollingTimer = null
    return Promise.resolve()
  })

  const assertClean = (): void => {
    if (pollingTimer !== null) throw new Error('fake Telegram bot is still polling')
  }

  return {
    bot,
    factory: () => bot,
    membershipCalls: () => calls.slice(),
    pollingTimer: () => pollingTimer,
    assertClean,
  }
}
