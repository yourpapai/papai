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
  pollingTimer(): null
  assertClean(): void
}

export function createFakeTelegramBot(options: FakeTelegramBotOptions): FakeTelegramBot {
  const calls: Array<[number, number]> = []
  const bot: TelegramBotLike = {
    on: () => undefined,
    command: () => undefined,
    start: async () => {},
    stop: async () => {},
    api: {
      getChatMember(chatId, userId) {
        calls.push([chatId, userId])
        return options.getChatMember(chatId, userId)
      },
    },
  }

  return {
    bot,
    factory: () => bot,
    membershipCalls: () => calls.slice(),
    pollingTimer: () => null,
    assertClean() {},
  }
}
