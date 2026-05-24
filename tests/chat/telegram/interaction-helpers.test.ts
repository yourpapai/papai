// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildTelegramInteraction } from '../../../src/chat/telegram/interaction-helpers.js'

describe('buildTelegramInteraction', () => {
  test('maps callback query data into an incoming interaction', () => {
    const interaction = buildTelegramInteraction(
      {
        from: { id: 42, username: 'alice' },
        chat: { id: 99, type: 'private' },
        callbackQuery: {
          data: 'cfg:edit:timezone',
          message: { message_id: 7, message_thread_id: 5 },
        },
      },
      true,
    )

    expect(interaction).toEqual({
      kind: 'button',
      user: { id: '42', username: 'alice', isAdmin: true },
      contextId: '99',
      contextType: 'dm',
      platformInstanceId: 'telegram-default',
      storageContextId: '99',
      callbackData: 'cfg:edit:timezone',
      messageId: '7',
      threadId: '5',
    })
  })

  test('includes thread-scoped storageContextId for forum topics', () => {
    const interaction = buildTelegramInteraction(
      {
        from: { id: 42, username: 'alice' },
        chat: { id: 100, type: 'supergroup' },
        callbackQuery: {
          data: 'wizard_confirm',
          message: { message_id: 7, message_thread_id: 5 },
        },
      },
      false,
    )

    expect(interaction).toEqual({
      kind: 'button',
      user: { id: '42', username: 'alice', isAdmin: false },
      contextId: '100',
      contextType: 'group',
      platformInstanceId: 'telegram-default',
      // storageContextId must include threadId for wizard session lookup
      storageContextId: '100:5',
      callbackData: 'wizard_confirm',
      messageId: '7',
      threadId: '5',
    })
  })

  test('uses the provided platform instance ID', () => {
    const interaction = buildTelegramInteraction(
      {
        from: { id: 42, username: 'alice' },
        chat: { id: 99, type: 'private' },
        callbackQuery: {
          data: 'cfg:edit:timezone',
          message: { message_id: 7 },
        },
      },
      true,
      'telegram-secondary',
    )

    expect(interaction?.platformInstanceId).toBe('telegram-secondary')
  })

  test('returns null when callback data is missing', () => {
    const interaction = buildTelegramInteraction(
      { from: { id: 42 }, chat: { id: 99, type: 'private' }, callbackQuery: {} },
      false,
    )

    expect(interaction).toBeNull()
  })

  test('returns null when from.id is missing', () => {
    const interaction = buildTelegramInteraction(
      {
        from: { username: 'alice' },
        chat: { id: 99, type: 'private' },
        callbackQuery: { data: 'cfg:edit:timezone' },
      },
      false,
    )

    expect(interaction).toBeNull()
  })
})
