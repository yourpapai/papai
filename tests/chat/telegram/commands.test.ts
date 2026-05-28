// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import * as commandCatalog from '../../../src/commands/catalog.js'
import type { CommandCatalogEntry } from '../../../src/commands/catalog.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../../utils/test-helpers.js'

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

type ExpectedCommandPayload = {
  readonly command: string
  readonly description: string
}

type FailureScenario = {
  readonly failingScope: string
  readonly failingCall: number
  readonly useDelete: boolean
}

type TelegramCommandsModule = typeof import('../../../src/chat/telegram/commands.js')

function requireCall(calls: readonly SetMyCommandsCall[], index: number): SetMyCommandsCall {
  const call = calls[index]
  if (call === undefined) {
    throw new Error(`Expected setMyCommands call at index ${index}`)
  }
  return call
}

function expectCommandPayload(
  commands: readonly TelegramPublishedCommand[],
  expected: readonly ExpectedCommandPayload[],
): void {
  expect(commands).toEqual(expected)
}

function isTelegramCommandsModule(module: unknown): module is TelegramCommandsModule {
  return (
    typeof module === 'object' &&
    module !== null &&
    'registerTelegramCommands' in module &&
    typeof module.registerTelegramCommands === 'function'
  )
}

describe('registerTelegramCommands', () => {
  let calls: SetMyCommandsCall[]
  let deleteCalls: DeleteMyCommandsCall[]
  const trackedLogger: TrackedLoggerMock = createTrackedLoggerMock()

  async function loadRegisterTelegramCommands(): Promise<
    typeof import('../../../src/chat/telegram/commands.js').registerTelegramCommands
  > {
    const module: unknown = await import(`../../../src/chat/telegram/commands.js?test=${crypto.randomUUID()}`)

    if (!isTelegramCommandsModule(module)) {
      throw new Error('Failed to load Telegram commands module for testing')
    }

    return module.registerTelegramCommands
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

  async function expectPublicationFailureLog(scenario: FailureScenario): Promise<void> {
    const publicationFailure = new Error('telegram publish failed')

    const bot: TestBot = {
      api: {
        setMyCommands: (commands, options) => {
          calls.push([commands, options])
          if (!scenario.useDelete && calls.length - 1 === scenario.failingCall) {
            return Promise.reject(publicationFailure)
          }
          return Promise.resolve(true)
        },
        deleteMyCommands: (options) => {
          deleteCalls.push([options])
          if (scenario.useDelete) {
            return Promise.reject(publicationFailure)
          }
          return Promise.resolve(true)
        },
      },
    }

    if (scenario.useDelete) {
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
    }

    const registerTelegramCommands = await loadRegisterTelegramCommands()

    await expect(registerTelegramCommands(bot, '12345')).rejects.toThrow('telegram publish failed')
    expect(trackedLogger.getCallsByLevel('error')).toContainEqual({
      level: 'error',
      args: [{ err: publicationFailure, scope: scenario.failingScope }, 'Telegram command publication failed'],
    })
  }

  beforeEach(() => {
    calls = []
    deleteCalls = []
    trackedLogger.clearCalls()
    void mock.module('../../../src/commands/catalog.js', () => ({ ...commandCatalog }))
    void mock.module('../../../src/logger.js', () => ({
      getLogLevel: trackedLogger.getLogLevel,
      logger: trackedLogger.logger,
    }))
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

    expectCommandPayload(privateDmCall[0], [
      { command: 'help', description: 'Show available commands' },
      { command: 'start', description: 'Show welcome and getting-started guidance' },
      { command: 'setup', description: 'Interactive configuration wizard' },
      { command: 'config', description: 'View or edit current configuration' },
      { command: 'context', description: 'Show current LLM context usage' },
      { command: 'clear', description: 'Clear conversation history and memory' },
    ])
    expect(privateDmCall[1]).toEqual({ scope: { type: 'all_private_chats' } })

    expectCommandPayload(adminDmCall[0], [
      { command: 'help', description: 'Show available commands' },
      { command: 'start', description: 'Show welcome and getting-started guidance' },
      { command: 'setup', description: 'Interactive configuration wizard' },
      { command: 'config', description: 'View or edit current configuration' },
      { command: 'context', description: 'Show current LLM context usage' },
      { command: 'clear', description: 'Clear conversation history and memory' },
      { command: 'group', description: 'Manage group authorization or membership' },
      { command: 'groups', description: 'List authorized groups' },
      { command: 'user', description: 'Manage users' },
      { command: 'users', description: 'List authorized users' },
      { command: 'announce', description: 'Send announcement to all authorized users' },
      { command: 'plugin', description: 'Manage plugins' },
    ])
    expect(adminDmCall[1]).toEqual({ scope: { type: 'chat', chat_id: 12345 } })

    expectCommandPayload(groupUserCall[0], [
      { command: 'help', description: 'Show available commands' },
      { command: 'context', description: 'Show current LLM context usage' },
      { command: 'clear', description: 'Clear conversation history and memory' },
      { command: 'group', description: 'Manage group authorization or membership' },
    ])
    expect(groupUserCall[1]).toEqual({ scope: { type: 'all_group_chats' } })

    expectCommandPayload(groupAdminCall[0], [
      { command: 'help', description: 'Show available commands' },
      { command: 'context', description: 'Show current LLM context usage' },
      { command: 'clear', description: 'Clear conversation history and memory' },
      { command: 'group', description: 'Manage group authorization or membership' },
    ])
    expect(groupAdminCall[1]).toEqual({ scope: { type: 'all_chat_administrators' } })
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

  test('logs the all_private_chats publication scope before rethrowing', async () => {
    await expectPublicationFailureLog({ failingScope: 'all_private_chats', failingCall: 0, useDelete: false })
  })

  test('logs the admin chat publication scope before rethrowing', async () => {
    await expectPublicationFailureLog({ failingScope: 'chat', failingCall: 1, useDelete: false })
  })

  test('logs the all_group_chats publication scope before rethrowing', async () => {
    await expectPublicationFailureLog({ failingScope: 'all_group_chats', failingCall: 2, useDelete: false })
  })

  test('logs the group-admin publication scope before rethrowing', async () => {
    await expectPublicationFailureLog({ failingScope: 'all_chat_administrators', failingCall: 3, useDelete: false })
  })

  test('logs the group-admin clear scope before rethrowing', async () => {
    await expectPublicationFailureLog({ failingScope: 'all_chat_administrators', failingCall: 3, useDelete: true })
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
})
