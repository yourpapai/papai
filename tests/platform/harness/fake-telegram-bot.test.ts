// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createFakeTelegramBot } from './fake-telegram-bot.js'

describe('fake Telegram bot', () => {
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
})
