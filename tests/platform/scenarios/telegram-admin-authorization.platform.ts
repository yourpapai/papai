// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { clearGroupAdminLiveCache, userManagesAuthorizedGroupLive } from '../../../src/chat/group-admin-live.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'
import { mockLogger } from '../../utils/test-helpers.js'
import { createFakeTelegramBot, type FakeTelegramBot } from '../harness/fake-telegram-bot.js'
import { PLATFORM_STORIES } from './catalog.js'

const PLATFORM_INSTANCE_ID = 'telegram-platform'
const NATIVE_GROUP_ID = '-100'
const NATIVE_USER_ID = '42'
const AUTHORIZED_GROUP_ID = toScopedContextId({
  platformInstanceId: PLATFORM_INSTANCE_ID,
  nativeContextId: NATIVE_GROUP_ID,
})
const title = (scenarioId: keyof typeof PLATFORM_STORIES): string => PLATFORM_STORIES[scenarioId].title

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
    ] as const) {
      const { fake, provider } = createProvider(row.outcome)

      await provider.start()
      await expect(provider.isGroupAdmin(PLATFORM_INSTANCE_ID, NATIVE_GROUP_ID, NATIVE_USER_ID)).resolves.toBe(
        row.expected,
      )
      await provider.stop()
      expect(fake.membershipCalls()).toEqual([[-100, 42]])
      fake.assertClean()
    }

    const unavailable = createProvider(new Error('fake Bot API unavailable'))
    await unavailable.provider.start()
    await expect(
      unavailable.provider.isGroupAdmin(PLATFORM_INSTANCE_ID, NATIVE_GROUP_ID, NATIVE_USER_ID),
    ).resolves.toBeNull()
    clearGroupAdminLiveCache()
    await expect(
      userManagesAuthorizedGroupLive(
        { isGroupAdmin: unavailable.provider.isGroupAdmin.bind(unavailable.provider) },
        NATIVE_USER_ID,
        PLATFORM_INSTANCE_ID,
        {
          listAuthorizedGroupIds: () => [AUTHORIZED_GROUP_ID],
          now: () => 0,
        },
      ),
    ).resolves.toBe(false)
    await unavailable.provider.stop()
    expect(unavailable.fake.membershipCalls()).toEqual([
      [-100, 42],
      [-100, 42],
    ])
    unavailable.fake.assertClean()

    const { fake, provider } = createProvider({ status: 'creator' })
    await provider.start()
    await expect(provider.isGroupAdmin(PLATFORM_INSTANCE_ID, 'not-a-number', '42')).resolves.toBeNull()
    await provider.stop()
    expect(fake.membershipCalls()).toEqual([])
    fake.assertClean()
  })
})
