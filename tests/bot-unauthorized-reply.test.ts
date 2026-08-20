// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getUnauthorizedReplyText, replyToUnauthorized } from '../src/bot-unauthorized-reply.js'
import type { AuthorizationDenyReason } from '../src/chat/authorization-types.js'
import type { AuthorizationResult } from '../src/chat/types.js'
import { setConfigValue } from '../src/config.js'
import { createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

const makeAuth = (reason: AuthorizationDenyReason | undefined): AuthorizationResult => ({
  allowed: false,
  reason,
  storageContextId: 'ctx-1',
  configContextId: 'cfg-1',
  isBotAdmin: false,
  isGroupAdmin: false,
  configCommandAllowed: false,
})

describe('getUnauthorizedReplyText', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns group_not_allowed message', () => {
    const text = getUnauthorizedReplyText(makeAuth('group_not_allowed'), 'grp-1')
    expect(text).toContain('grp-1')
    expect(text).toContain('not authorized')
  })

  test('returns group_member_not_allowed message', () => {
    const text = getUnauthorizedReplyText(makeAuth('group_member_not_allowed'), 'grp-1')
    expect(text).toContain('not authorized')
  })

  test('returns dm_not_allowed message', () => {
    const text = getUnauthorizedReplyText(makeAuth('dm_not_allowed'), 'grp-1')
    expect(text).toBe('You are not authorized to use this bot.')
  })

  test('returns user_blocked message', () => {
    const text = getUnauthorizedReplyText(makeAuth('user_blocked'), 'grp-1')
    expect(text).toBe('You are not authorized to use this bot.')
  })

  test('returns null when reason is undefined', () => {
    const text = getUnauthorizedReplyText(makeAuth(undefined), 'grp-1')
    expect(text).toBeNull()
  })
})

describe('replyToUnauthorized', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('sends reply text when reason is known', async () => {
    const { reply, textCalls } = createMockReply()
    await replyToUnauthorized(reply, makeAuth('dm_not_allowed'), 'grp-1')
    expect(textCalls).toEqual(['You are not authorized to use this bot.'])
  })

  test('does not send reply when reason produces null text', async () => {
    const { reply, textCalls } = createMockReply()
    await replyToUnauthorized(reply, makeAuth(undefined), 'grp-1')
    expect(textCalls).toHaveLength(0)
  })
})

describe('unauthorized replies per locale', () => {
  const RU_CFG = 'cfg-unauth-ru'

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setConfigValue(RU_CFG, 'language', 'ru')
  })

  test('renders the ru group_not_allowed message with the group id interpolated', () => {
    const text = getUnauthorizedReplyText({ ...makeAuth('group_not_allowed'), configContextId: RU_CFG }, 'grp-9')
    expect(text).toBe(
      'Эта группа (grp-9) не авторизована для работы с этим ботом. Попросите администратора бота авторизовать её в веб-интерфейсе настроек — его можно открыть командой `/config` в личных сообщениях.',
    )
  })

  test('renders the ru group_member_not_allowed message', () => {
    const text = getUnauthorizedReplyText({ ...makeAuth('group_member_not_allowed'), configContextId: RU_CFG }, 'grp-9')
    expect(text).toBe(
      'Вы не авторизованы для работы с этим ботом в этой группе. Попросите администратора группы добавить вас в веб-интерфейсе настроек — его можно открыть командой `/config` в личных сообщениях.',
    )
  })

  test('renders the ru dm_not_allowed message', () => {
    const text = getUnauthorizedReplyText({ ...makeAuth('dm_not_allowed'), configContextId: RU_CFG }, 'grp-9')
    expect(text).toBe('Вы не авторизованы для работы с этим ботом.')
  })

  test('renders the ru user_blocked message', () => {
    const text = getUnauthorizedReplyText({ ...makeAuth('user_blocked'), configContextId: RU_CFG }, 'grp-9')
    expect(text).toBe('Вы не авторизованы для работы с этим ботом.')
  })

  test('falls back to the en text for an en-configured context', () => {
    const text = getUnauthorizedReplyText(
      { ...makeAuth('group_not_allowed'), configContextId: 'cfg-unauth-en' },
      'grp-9',
    )
    expect(text).toBe(
      'This group (grp-9) is not authorized to use this bot. Ask the bot admin to authorize it in the settings web UI — they can open it with `/config` in a DM.',
    )
  })

  test('replyToUnauthorized sends the localized text', async () => {
    const { reply, textCalls } = createMockReply()
    await replyToUnauthorized(reply, { ...makeAuth('dm_not_allowed'), configContextId: RU_CFG }, 'grp-9')
    expect(textCalls).toEqual(['Вы не авторизованы для работы с этим ботом.'])
  })
})
