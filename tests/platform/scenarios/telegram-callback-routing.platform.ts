// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { addAuthorizedGroup } from '../../../src/authorized-groups.js'
import { setupBot } from '../../../src/bot.js'
import { askPermissionViaChat } from '../../../src/chat/permission-prompt.js'
import { resetPermissionPromptForTesting } from '../../../src/chat/permission-prompt.testing.js'
import { ChatRouter } from '../../../src/chat/router.js'
import { toScopedContextId, toScopedThreadContextId } from '../../../src/chat/scoped-context.js'
import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'
import type { PromptHandle, ReplyFn } from '../../../src/chat/types.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { createFakeTelegramBot, type CallbackContext, type FakeTelegramBot } from '../harness/fake-telegram-bot.js'

const PLATFORM_INSTANCE_ID = 'telegram-platform'
const ADMIN_USER_ID = 'telegram-admin'
const NATIVE_GROUP_ID = '-100'
const NATIVE_GROUP_ID_NUM = -100
const THREAD_ID = '7'
const THREAD_ID_NUM = 7
const NATIVE_USER_ID = '42'
const NATIVE_USER_ID_NUM = 42
const MEMBER_USERNAME = 'alice'
const PROMPT_MESSAGE_ID_NUM = 321

const SCENARIO_TITLES = {
  'SCN-interaction-telegram-callback':
    'routes a Telegram permission callback through ChatRouter and production setupBot',
} as const

const title = (scenarioId: keyof typeof SCENARIO_TITLES): string => SCENARIO_TITLES[scenarioId]

const groupConfigContextId = toScopedContextId({
  platformInstanceId: PLATFORM_INSTANCE_ID,
  nativeContextId: NATIVE_GROUP_ID,
})

const threadStorageContextId = toScopedThreadContextId({
  platformInstanceId: PLATFORM_INSTANCE_ID,
  nativeContextId: NATIVE_GROUP_ID,
  threadId: THREAD_ID,
})

type LocalCallbackContext = CallbackContext & {
  message?: { message_id?: number; message_thread_id?: number }
}

const groupChat = { id: NATIVE_GROUP_ID_NUM, type: 'supergroup' as const, title: 'g' }
const callbackMessage = {
  message_id: PROMPT_MESSAGE_ID_NUM,
  date: 1700000000,
  chat: groupChat,
  message_thread_id: THREAD_ID_NUM,
}

const callbackContext = (data: string): LocalCallbackContext => ({
  callbackQuery: {
    id: 'cb-1',
    from: { id: NATIVE_USER_ID_NUM, is_bot: false, first_name: 'Alice' },
    chat_instance: '0',
    data,
    message: callbackMessage,
  },
  from: { id: NATIVE_USER_ID_NUM, is_bot: false, first_name: 'Alice', username: MEMBER_USERNAME },
  chat: groupChat,
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
  message: { message_id: PROMPT_MESSAGE_ID_NUM, message_thread_id: THREAD_ID_NUM },
  answerCallbackQuery: (): Promise<true> => Promise.resolve(true),
})

describe('T3 Telegram — callback routing', () => {
  let fake: FakeTelegramBot
  let router: ChatRouter

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetPermissionPromptForTesting()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID, type: 'telegram' })
    addAuthorizedGroup(groupConfigContextId, ADMIN_USER_ID)
    addUser({
      userId: NATIVE_USER_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
      addedBy: ADMIN_USER_ID,
      username: MEMBER_USERNAME,
    })

    fake = createFakeTelegramBot({ getChatMember: () => Promise.resolve({ status: 'member' }) })
    const provider = new TelegramChatProvider({
      token: 'telegram-test-token',
      platformInstanceId: PLATFORM_INSTANCE_ID,
      botFactory: fake.factory,
    })
    router = new ChatRouter(() => provider)
    router.addInstance(PLATFORM_INSTANCE_ID, 'telegram', { token: 'telegram-test-token' })
    setupBot(router, ADMIN_USER_ID)
    await router.start()
  })

  afterEach(async () => {
    resetPermissionPromptForTesting()
    await router.stop()
    fake.assertClean()
  })

  test(title('SCN-interaction-telegram-callback'), async () => {
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
        capturedCallbackData.push(options.buttons![1]!.callbackData)
        return Promise.resolve(promptHandle)
      },
    }

    const decision = askPermissionViaChat(promptReply, threadStorageContextId, {
      toolName: 'delete_task',
      reason: 'cleanup',
      args: { id: 'task-9' },
    })
    await Promise.resolve()
    const denyCallbackData = capturedCallbackData[0]!

    fake.emitCallback(callbackContext(denyCallbackData))
    await fake.flush()

    await expect(decision).resolves.toBe('deny')
    expect(promptHandle.remove).toHaveBeenCalledTimes(1)
    expect(fake.callbackAnswers()).toEqual([{ text: 'Denied delete_task 🚫' }])
    expect(fake.callbackAnswers()).toHaveLength(1)
  })
})
