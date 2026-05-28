// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { registerTelegramCommands } from '../../../src/chat/telegram/commands.js'

type TelegramPublishedCommand = {
  readonly command: string
  readonly description: string
}

type SetMyCommandsCall = [
  commands: readonly TelegramPublishedCommand[],
  options: { scope: { type: string; chat_id?: number } },
]

type TestBot = {
  readonly api: {
    setMyCommands: (
      commands: readonly TelegramPublishedCommand[],
      options: { scope: { type: string; chat_id?: number } },
    ) => Promise<boolean>
  }
}

function commandNames(commands: readonly TelegramPublishedCommand[]): readonly string[] {
  return commands.map((command) => command.command)
}

function expectIncludesCommands(actual: readonly string[], expected: readonly string[]): void {
  for (const command of expected) {
    expect(actual.includes(command)).toBe(true)
  }
}

function requireCall(calls: readonly SetMyCommandsCall[], index: number): SetMyCommandsCall {
  const call = calls[index]
  if (call === undefined) {
    throw new Error(`Expected setMyCommands call at index ${index}`)
  }
  return call
}

describe('registerTelegramCommands', () => {
  let calls: SetMyCommandsCall[]

  function createBot(): TestBot {
    return {
      api: {
        setMyCommands: (commands, options) => {
          calls.push([commands, options])
          return Promise.resolve(true)
        },
      },
    }
  }

  beforeEach(() => {
    calls = []
  })

  test('publishes DM, admin-DM, group, and group-admin scopes from the catalog', async () => {
    const bot = createBot()

    await registerTelegramCommands(bot, '12345')

    expect(calls).toHaveLength(4)

    const privateDmCall = requireCall(calls, 0)
    const adminDmCall = requireCall(calls, 1)
    const groupUserCall = requireCall(calls, 2)
    const groupAdminCall = requireCall(calls, 3)

    expectIncludesCommands(commandNames(privateDmCall[0]), ['help', 'setup', 'config'])
    expect(privateDmCall[1]).toEqual({ scope: { type: 'all_private_chats' } })

    expectIncludesCommands(commandNames(adminDmCall[0]), ['user', 'plugin'])
    expect(adminDmCall[1]).toEqual({ scope: { type: 'chat', chat_id: 12345 } })

    expectIncludesCommands(commandNames(groupUserCall[0]), ['help', 'context', 'clear', 'group'])
    expect(groupUserCall[1]).toEqual({ scope: { type: 'all_group_chats' } })

    expectIncludesCommands(commandNames(groupAdminCall[0]), ['help', 'context', 'clear', 'group'])
    expect(groupAdminCall[1]).toEqual({ scope: { type: 'all_chat_administrators' } })
  })

  test('throws when admin user id is not numeric for Telegram chat scope', async () => {
    const bot = createBot()

    await expect(registerTelegramCommands(bot, 'admin-user')).rejects.toThrow(
      'Telegram admin command scope requires a numeric ADMIN_USER_ID',
    )
    expect(calls).toHaveLength(0)
  })
})
