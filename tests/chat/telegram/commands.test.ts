// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { CommandCatalogEntry } from '../../../src/commands/catalog.js'

type TelegramPublishedCommand = {
  readonly command: string
  readonly description: string
}

type SetMyCommandsCall = [
  commands: readonly TelegramPublishedCommand[],
  options: { scope: { type: string; chat_id?: number } },
]

type DeleteMyCommandsCall = [options: { scope: { type: string; chat_id?: number } }]

type TestBot = {
  readonly api: {
    setMyCommands: (
      commands: readonly TelegramPublishedCommand[],
      options: { scope: { type: string; chat_id?: number } },
    ) => Promise<boolean>
    deleteMyCommands: (options: { scope: { type: string; chat_id?: number } }) => Promise<boolean>
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
  let deleteCalls: DeleteMyCommandsCall[]

  async function loadRegisterTelegramCommands(): Promise<
    typeof import('../../../src/chat/telegram/commands.js').registerTelegramCommands
  > {
    return (await import('../../../src/chat/telegram/commands.js')).registerTelegramCommands
  }

  function createBot(): TestBot {
    return {
      api: {
        setMyCommands: (commands, options) => {
          calls.push([commands, options])
          return Promise.resolve(true)
        },
        deleteMyCommands: (options) => {
          deleteCalls.push([options])
          return Promise.resolve(true)
        },
      },
    }
  }

  beforeEach(() => {
    calls = []
    deleteCalls = []
  })

  test('publishes DM, admin-DM, group, and group-admin scopes from the catalog', async () => {
    const bot = createBot()
    const registerTelegramCommands = await loadRegisterTelegramCommands()

    await registerTelegramCommands(bot, '12345')

    expect(calls).toHaveLength(4)
    expect(deleteCalls).toHaveLength(0)

    const privateDmCall = requireCall(calls, 0)
    const adminDmCall = requireCall(calls, 1)
    const groupUserCall = requireCall(calls, 2)
    const groupAdminCall = requireCall(calls, 3)

    expect(privateDmCall[0].map((command) => command.command)).toEqual([
      'help',
      'start',
      'setup',
      'config',
      'context',
      'clear',
    ])
    expect(privateDmCall[1]).toEqual({ scope: { type: 'all_private_chats' } })

    expect(adminDmCall[0].map((command) => command.command)).toEqual([
      'help',
      'start',
      'setup',
      'config',
      'context',
      'clear',
      'group',
      'groups',
      'user',
      'users',
      'announce',
      'plugin',
    ])
    expect(adminDmCall[1]).toEqual({ scope: { type: 'chat', chat_id: 12345 } })

    expect(groupUserCall[0].map((command) => command.command)).toEqual(['help', 'context', 'clear', 'group'])
    expect(groupUserCall[1]).toEqual({ scope: { type: 'all_group_chats' } })

    expect(groupAdminCall[0].map((command) => command.command)).toEqual(['help', 'context', 'clear', 'group'])
    expect(groupAdminCall[1]).toEqual({ scope: { type: 'all_chat_administrators' } })
  })

  test('clears the group-admin scope when the catalog has no admin-group commands', async () => {
    void mock.module('../../../src/commands/catalog.js', () => ({
      listCommandCatalogEntries: (): readonly CommandCatalogEntry[] => [
        {
          name: 'help',
          description: 'Show available commands',
          registration: 'registerHelpCommand',
          telegram: {
            publishInDmUser: true,
            publishInDmAdmin: true,
            publishInGroupUser: true,
            publishInGroupAdmin: false,
          },
        },
      ],
    }))

    const bot = createBot()
    const registerTelegramCommands = await loadRegisterTelegramCommands()

    await registerTelegramCommands(bot, '12345')

    expect(calls).toHaveLength(3)
    expect(deleteCalls).toEqual([[{ scope: { type: 'all_chat_administrators' } }]])
  })

  test('throws when admin user id is not numeric for Telegram chat scope', async () => {
    const bot = createBot()
    const registerTelegramCommands = await loadRegisterTelegramCommands()

    await expect(registerTelegramCommands(bot, 'admin-user')).rejects.toThrow(
      'Telegram admin command scope requires a numeric ADMIN_USER_ID',
    )
    expect(calls).toHaveLength(0)
    expect(deleteCalls).toHaveLength(0)
  })
})
