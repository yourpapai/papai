// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerConfigCommand } from '../../src/commands/config.js'
import { ISSUE_LIMIT } from '../../src/settings/issue-link.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

const USER_ID = 'config-test-user'

const originalSettingsBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']

describe('/config settings link issuance', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    delete process.env['SETTINGS_PUBLIC_BASE_URL']
  })

  afterEach(() => {
    if (originalSettingsBaseUrl === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = originalSettingsBaseUrl
  })

  test('replies with a single-use settings link when configured', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerConfigCommand(mockChat)
    const handler = commandHandlers.get('config')
    assert.ok(handler !== undefined, 'expected config handler to be registered')

    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage(USER_ID), reply, createAuth(USER_ID))

    const allText = textCalls.join('\n')
    expect(allText).toContain('https://bot.example.com/settings?code=')
    expect(allText).toMatch(/single-use/iu)
    expect(textCalls).toHaveLength(1)
  })

  test('warns when settings links are rate limited', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerConfigCommand(mockChat)
    const handler = commandHandlers.get('config')
    assert.ok(handler !== undefined, 'expected config handler to be registered')

    const msg = createDmMessage(USER_ID)
    const auth = createAuth(USER_ID)
    // ISSUE_LIMIT = 5; invoking ISSUE_LIMIT+1 times exhausts the quota on the last call
    let lastReply = createMockReply()
    for (let i = 0; i < ISSUE_LIMIT + 1; i += 1) {
      lastReply = createMockReply()
      await handler(msg, lastReply.reply, auth)
    }
    expect(lastReply.textCalls.join('\n').toLowerCase()).toContain('too many')
  })

  test('replies with a not-configured message when SETTINGS_PUBLIC_BASE_URL is unset', async () => {
    // SETTINGS_PUBLIC_BASE_URL is deleted in beforeEach, so issueSettingsLink returns { kind: 'not_configured' }
    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerConfigCommand(mockChat)
    const handler = commandHandlers.get('config')
    assert.ok(handler !== undefined, 'expected config handler to be registered')

    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage(USER_ID), reply, createAuth(USER_ID))

    expect(textCalls.join('\n')).toContain('SETTINGS_PUBLIC_BASE_URL')
  })

  test('redirects group admin to DM in group context', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerConfigCommand(mockChat)
    const handler = commandHandlers.get('config')
    assert.ok(handler !== undefined, 'expected config handler to be registered')

    const { reply, textCalls } = createMockReply()
    await handler(createGroupMessage(USER_ID, '/config', true), reply, createAuth(USER_ID, { isGroupAdmin: true }))

    expect(textCalls.join('\n')).toContain('direct messages')
  })

  test('tells non-admin group member that only admins can configure in group context', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerConfigCommand(mockChat)
    const handler = commandHandlers.get('config')
    assert.ok(handler !== undefined, 'expected config handler to be registered')

    const { reply, textCalls } = createMockReply()
    await handler(createGroupMessage(USER_ID, '/config', false), reply, createAuth(USER_ID, { isGroupAdmin: false }))

    expect(textCalls.join('\n')).toContain('Only group admins')
  })

  test('rejects unauthorized user silently', async () => {
    const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
    registerConfigCommand(mockChat)
    const handler = commandHandlers.get('config')
    assert.ok(handler !== undefined, 'expected config handler to be registered')

    const { reply, textCalls } = createMockReply()
    await handler(createDmMessage(USER_ID), reply, createAuth(USER_ID, { allowed: false }))

    expect(textCalls).toHaveLength(0)
  })
})

// This export is kept as a type-level guard: if CommandHandler changes shape
// the test file should still compile.
export type { CommandHandler }
