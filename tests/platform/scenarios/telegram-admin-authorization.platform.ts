// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'
import { mockLogger } from '../../utils/test-helpers.js'
import { createFakeTelegramBot, type FakeTelegramBot } from '../harness/fake-telegram-bot.js'

const PLATFORM_INSTANCE_ID = 'telegram-platform'
const title = (scenarioId: string): string => scenarioId

type MembershipOutcome = { status: string } | Error

function outcomeToPromise(outcome: MembershipOutcome): Promise<{ status: string }> {
  return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome)
}

function createProvider(outcome: MembershipOutcome): { fake: FakeTelegramBot; provider: TelegramChatProvider } {
  const fake = createFakeTelegramBot({ getChatMember: () => outcomeToPromise(outcome) })
  const provider = new TelegramChatProvider({
    token: 'telegram-test-token',
    platformInstanceId: PLATFORM_INSTANCE_ID,
    botFactory: fake.factory,
  })
  return { fake, provider }
}

describe('T3 Telegram — live group authorization', () => {
  test(title('SCN-interaction-telegram-admin-authorization'), async () => {
    mockLogger()
    for (const row of [
      { outcome: { status: 'creator' }, expected: true },
      { outcome: { status: 'administrator' }, expected: true },
      { outcome: { status: 'member' }, expected: false },
      { outcome: new Error('fake Bot API unavailable'), expected: null },
    ] as const) {
      const { fake, provider } = createProvider(row.outcome)

      await expect(provider.isGroupAdmin(PLATFORM_INSTANCE_ID, '-100', '42')).resolves.toBe(row.expected)
      expect(fake.membershipCalls()).toEqual([[-100, 42]])
      fake.assertClean()
    }

    const { fake, provider } = createProvider({ status: 'creator' })
    await expect(provider.isGroupAdmin(PLATFORM_INSTANCE_ID, 'not-a-number', '42')).resolves.toBeNull()
    expect(fake.membershipCalls()).toEqual([])
    fake.assertClean()
  })
})
