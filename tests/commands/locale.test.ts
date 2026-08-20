// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { AuthorizationResult, CommandHandler } from '../../src/chat/types.js'
import { registerClearCommand } from '../../src/commands/clear.js'
import { registerConfigCommand } from '../../src/commands/config.js'
import { registerContextCommand } from '../../src/commands/context.js'
import { registerDashboardCommand } from '../../src/commands/dashboard.js'
import { registerHelpCommand } from '../../src/commands/help.js'
import { registerStopCommand } from '../../src/commands/stop.js'
import { setConfigValue } from '../../src/config.js'
import {
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

const RU_CTX = 'cmd-locale-ru'
const EN_CTX = 'cmd-locale-en'

const auth = (ctx: string, overrides?: Partial<AuthorizationResult>): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: ctx,
  configContextId: ctx,
  ...overrides,
})

function getHandler(
  name: string,
  register: (provider: ReturnType<typeof createMockChatWithCommandHandlers>['provider']) => void,
): CommandHandler {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()
  register(provider)
  const handler = commandHandlers.get(name)
  if (handler === undefined) throw new Error(`${name} handler not registered`)
  return handler
}

describe('command rendering per locale', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    setConfigValue(RU_CTX, 'language', 'ru')
  })

  describe('help', () => {
    const handler = (): CommandHandler => getHandler('help', registerHelpCommand)

    test('renders Russian help for a ru-configured context', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createDmMessage('u1'), reply, auth(RU_CTX))
      expect(getReplies()[0]).toContain('ИИ-ассистент')
      expect(getReplies()[0]).toContain('/config')
    })

    test('renders English help otherwise', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createDmMessage('u1'), reply, auth(EN_CTX))
      expect(getReplies()[0]).toContain('AI assistant for Kaneo task management')
    })
  })

  describe('clear', () => {
    const handler = (): CommandHandler => getHandler('clear', (p) => registerClearCommand(p, undefined, ''))

    test('renders the Russian self-cleared ack for a ru-configured context', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createDmMessage('u1'), reply, auth(RU_CTX))
      expect(getReplies()[0]).toContain('История диалога, память и факты очищены.')
    })

    test('renders the English self-cleared ack otherwise', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createDmMessage('u1'), reply, auth(EN_CTX))
      expect(getReplies()[0]).toBe('Conversation history, memory, and facts cleared.')
    })
  })

  describe('config', () => {
    const handler = (): CommandHandler => getHandler('config', registerConfigCommand)

    test('renders the Russian group redirect for a ru-configured group admin', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createGroupMessage('u1', '/config', true), reply, auth(RU_CTX, { isGroupAdmin: true }))
      expect(getReplies()[0]).toContain('Откройте личный чат со мной и выполните /config.')
    })

    test('renders the English group redirect otherwise', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createGroupMessage('u1', '/config', true), reply, auth(EN_CTX, { isGroupAdmin: true }))
      expect(getReplies()[0]).toContain('Open a DM with me and run /config.')
    })
  })

  describe('dashboard', () => {
    const handler = (): CommandHandler => getHandler('dashboard', (p) => registerDashboardCommand(p))

    test('renders the Russian DM-only reply for a ru-configured context', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createGroupMessage('u1', '/dashboard', true), reply, auth(RU_CTX, { isBotAdmin: true }))
      expect(getReplies()[0]).toContain('доступен только в личных сообщениях')
    })

    test('renders the English DM-only reply otherwise', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createGroupMessage('u1', '/dashboard', true), reply, auth(EN_CTX, { isBotAdmin: true }))
      expect(getReplies()[0]).toContain('`/dashboard` is DM-only')
    })
  })

  describe('stop', () => {
    const handler = (): CommandHandler => getHandler('stop', registerStopCommand)

    test('renders the Russian nothing-running ack for a ru-configured context', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createDmMessage('u1'), reply, auth(RU_CTX))
      expect(getReplies()[0]).toBe('Сейчас ничего не выполняется.')
    })

    test('renders the English nothing-running ack otherwise', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createDmMessage('u1'), reply, auth(EN_CTX))
      expect(getReplies()[0]).toBe('Nothing is running right now.')
    })
  })

  describe('context', () => {
    const handler = (): CommandHandler =>
      getHandler('context', (p) =>
        registerContextCommand(p, {
          collectContext: (): never => {
            throw new Error('collector failed')
          },
          buildProvider: () => null,
          buildLiveToolSet: () => ({}),
          resolveActiveToolDefinitions: () => ({}),
          resolveDisclosedToolDefinitions: () => ({}),
          resolveToolSurface: () => Promise.resolve({ definitions: {} }),
        }),
      )

    test('renders the Russian failure ack for a ru-configured context', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createDmMessage('u1'), reply, auth(RU_CTX))
      expect(getReplies()[0]).toBe('Извините — не удалось построить отображение контекста прямо сейчас.')
    })

    test('renders the English failure ack otherwise', async () => {
      const { reply, getReplies } = createMockReply()
      await handler()(createDmMessage('u1'), reply, auth(EN_CTX))
      expect(getReplies()[0]).toBe('Sorry — could not build context view right now.')
    })
  })
})
