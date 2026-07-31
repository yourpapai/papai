// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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
  let pollingTimer: object | null = null

  const bot: TelegramBotLike = {
    api: {
      sendMessage: () => Promise.resolve(),
      getChat: () => Promise.resolve({ id: 0 }),
      getChatMember(chatId, userId) {
        const numericChatId = Number(chatId)
        calls.push([numericChatId, userId])
        return options.getChatMember(numericChatId, userId)
      },
      getChatAdministrators: () => Promise.resolve([]),
      getFile: () => Promise.resolve({}),
      createForumTopic: () => Promise.resolve({ message_thread_id: 1 }),
      editMessageText: () => Promise.resolve(),
      deleteMessage: () => Promise.resolve(),
      setMyCommands: () => Promise.resolve(),
      deleteMyCommands: () => Promise.resolve(),
    },
    on: () => undefined,
    command: () => undefined,
    start(startOptions) {
      pollingTimer = { owner: 'fake-telegram-poller' }
      startOptions?.onStart?.({ username: 'papai' })
      return Promise.resolve()
    },
    stop() {
      pollingTimer = null
      return Promise.resolve()
    },
  }

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
