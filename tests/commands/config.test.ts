import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ChatCapability, CommandHandler } from '../../src/chat/types.js'
import { registerConfigCommand, renderConfigForTarget } from '../../src/commands/config.js'
import { setConfig } from '../../src/config.js'
import { clearUserCache } from '../utils/test-cache.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

const USER_ID = 'config-test-user'

describe('/config Command', () => {
  let configHandler: CommandHandler | null

  describe('with interactive button support', () => {
    beforeEach(async () => {
      mockLogger()
      await setupTestDb()
      clearUserCache(USER_ID)

      const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
      registerConfigCommand(mockChat, (_userId: string) => true)
      configHandler = commandHandlers.get('config') ?? null
    })

    test('shows all config keys with values and masked secrets', async () => {
      setConfig(USER_ID, 'llm_apikey', 'sk-abc1234')
      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)
      expect(buttonCalls[0]).toContain('****1234')
      expect(buttonCalls[0]).toContain('*(not set)*')
    })

    test('shows unset placeholder for unconfigured keys', async () => {
      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)
      assert(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      const output = buttonCalls[0]
      expect(output.length).toBeGreaterThan(0)
      const lines = output.split('\n').filter((line) => line.trim().length > 0)
      expect(lines.length).toBeGreaterThan(0)
      // Every config line should show "(not set)" since no keys are configured
      // (exclude the hint line at the end)
      const configLines = lines.filter((line) => line.includes(':'))
      expect(configLines.every((line) => line.includes('(not set)'))).toBe(true)
    })

    test('starts with a personal/group selector in DM', async () => {
      expect(configHandler).not.toBeNull()
      const { reply, buttonCalls } = createMockReply()

      await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID))

      expect(buttonCalls[0]).toContain('What do you want to configure?')
    })

    test('rejects unauthorized user silently', async () => {
      expect(configHandler).not.toBeNull()
      const { reply, buttonCalls } = createMockReply()
      await configHandler!(
        createDmMessage('unauthorized-user'),
        reply,
        createAuth('unauthorized-user', { allowed: false }),
      )
      expect(buttonCalls).toHaveLength(0)
    })
  })

  describe('without interactive button support', () => {
    beforeEach(async () => {
      mockLogger()
      await setupTestDb()
      clearUserCache(USER_ID)

      const capabilities = new Set<ChatCapability>([
        'commands.menu',
        'messages.files',
        'messages.redact',
        'files.receive',
        'messages.reply-context',
        'users.resolve',
        // messages.buttons and interactions.callbacks intentionally omitted
      ])
      const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers({ capabilities })
      registerConfigCommand(mockChat, (_userId: string) => true)
      configHandler = commandHandlers.get('config') ?? null
    })

    test('falls back to plain text with config output', async () => {
      setConfig(USER_ID, 'llm_apikey', 'sk-abc1234')
      const { reply, textCalls, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, false)
      expect(buttonCalls).toHaveLength(0)
      expect(textCalls).toHaveLength(1)
      assert(textCalls[0] !== undefined, 'expected textCalls[0] to be defined')
      const output = textCalls[0]
      expect(output).toContain('****1234')
    })

    test('includes note that interactive editing is unavailable', async () => {
      const { reply, textCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, false)
      assert(textCalls[0] !== undefined, 'expected textCalls[0] to be defined')
      const output = textCalls[0]
      expect(output).toContain('not available')
    })
  })
})
