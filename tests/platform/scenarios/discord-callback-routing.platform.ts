// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { setupBot } from '../../../src/bot.js'
import { DiscordChatProvider } from '../../../src/chat/discord/index.js'
import { askPermissionViaChat } from '../../../src/chat/permission-prompt.js'
import { resetPermissionPromptForTesting } from '../../../src/chat/permission-prompt.testing.js'
import { ChatRouter } from '../../../src/chat/router.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import type { IncomingMessage, PromptHandle, ReplyFn } from '../../../src/chat/types.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { createFakeDiscordClient, type FakeDiscordClient } from '../harness/fake-discord-client.js'

const PLATFORM_INSTANCE_ID = 'discord-platform'
const ADMIN_USER_ID = 'discord-admin'
const BOT_ID = 'discord-bot'
const MEMBER_ID = 'member-7'
const MEMBER_USERNAME = 'member-seven'
const PROMPT_MESSAGE_ID = 'prompt-message-1'
const FALLBACK_MESSAGE_ID = 'fallback-message-9'
const DM_CHANNEL_TYPE = 1

const SCENARIO_TITLES = {
  'SCN-interaction-discord-router-wrapped':
    'routes a Discord permission callback through ChatRouter and production setupBot',
  'SCN-interaction-discord-standalone-fallback':
    'defers an unmatched Discord callback to the standalone message fallback',
} as const

const title = (scenarioId: keyof typeof SCENARIO_TITLES): string => SCENARIO_TITLES[scenarioId]

const dmStorageContextId = toScopedContextId({
  platformInstanceId: PLATFORM_INSTANCE_ID,
  nativeContextId: MEMBER_ID,
})

function createProvider(fake: FakeDiscordClient): DiscordChatProvider {
  return new DiscordChatProvider({
    clientFactory: fake.factory,
    token: 'discord-test-token',
    platformInstanceId: PLATFORM_INSTANCE_ID,
  })
}

async function startProvider(fake: FakeDiscordClient, provider: DiscordChatProvider): Promise<void> {
  const started = provider.start()
  fake.emitReady()
  const flushed = fake.flush()
  await started
  await flushed
}

async function startRouter(fake: FakeDiscordClient, router: ChatRouter): Promise<void> {
  const started = router.start()
  await Promise.resolve()
  fake.emitReady()
  const flushed = fake.flush()
  await started
  await flushed
}

describe('T3 Discord — callback routing', () => {
  let fake: FakeDiscordClient
  let provider: DiscordChatProvider

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetPermissionPromptForTesting()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID, type: 'discord' })
    addUser({
      userId: MEMBER_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
      addedBy: ADMIN_USER_ID,
      username: MEMBER_USERNAME,
    })
    fake = createFakeDiscordClient({ botId: BOT_ID, username: 'papai' })
    fake.channel.type = DM_CHANNEL_TYPE
    provider = createProvider(fake)
  })

  afterEach(async () => {
    resetPermissionPromptForTesting()
    await provider.stop()
    fake.assertClean()
  })

  test(title('SCN-interaction-discord-router-wrapped'), async () => {
    const promptHandle: PromptHandle = {
      redact: mock((): Promise<void> => Promise.resolve()),
      remove: mock((): Promise<void> => Promise.resolve()),
    }
    const capturedCallbackData: string[] = []
    const promptReply: ReplyFn = {
      text: (): Promise<void> => Promise.resolve(),
      formatted: (): Promise<void> => Promise.resolve(),
      typing: (): void => {},
      buttons: (_body, options): Promise<PromptHandle | undefined> => {
        capturedCallbackData.push(options.buttons![0]!.callbackData)
        return Promise.resolve(promptHandle)
      },
    }

    const router = new ChatRouter(() => provider)
    router.addInstance(PLATFORM_INSTANCE_ID, 'discord', { token: 'discord-test-token' })
    setupBot(router, ADMIN_USER_ID)
    await startRouter(fake, router)

    const decision = askPermissionViaChat(promptReply, dmStorageContextId, {
      toolName: 'delete_task',
      reason: 'cleanup',
      args: { id: 'task-9' },
    })
    await Promise.resolve()
    const allowCallbackData = capturedCallbackData[0]!

    fake.emitButton({
      customId: allowCallbackData,
      user: { id: MEMBER_ID, username: MEMBER_USERNAME },
      message: { id: PROMPT_MESSAGE_ID },
    })
    await fake.flush()

    await expect(decision).resolves.toBe('allow')
    expect(promptHandle.remove).toHaveBeenCalledTimes(1)
    expect(fake.deferUpdateCalls()).toHaveLength(1)
    expect(fake.followUpCalls()).toEqual([{ content: 'Allowed delete_task ✅', flags: 64 }])

    await router.stop()
  })

  test(title('SCN-interaction-discord-standalone-fallback'), async () => {
    const received: IncomingMessage[] = []
    provider.onMessage((msg): Promise<void> => {
      received.push(msg)
      return Promise.resolve()
    })

    await startProvider(fake, provider)

    fake.emitButton({
      customId: 'unmatched-callback',
      user: { id: MEMBER_ID, username: MEMBER_USERNAME },
      message: { id: FALLBACK_MESSAGE_ID },
    })
    await fake.flush()

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      platformInstanceId: PLATFORM_INSTANCE_ID,
      messageId: FALLBACK_MESSAGE_ID,
      contextId: MEMBER_ID,
      contextType: 'dm',
      text: 'unmatched-callback',
    })
    expect(fake.deferUpdateCalls()).toHaveLength(1)
    expect(fake.followUpCalls()).toEqual([])
  })
})
