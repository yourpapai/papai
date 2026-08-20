// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import type { AuthorizationResult, IncomingInteraction } from '../../src/chat/types.js'
import { getConfigValue, setConfigValue } from '../../src/config.js'
import { createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

// The language preference is durable config: it must land on the config
// context, not the (thread-scoped) storage context.
const CONFIG_CTX = 'tg:u1:cfg'
const STORAGE_CTX = 'tg:u1:store'

const auth = (allowed: boolean, isGuest = false): AuthorizationResult => ({
  allowed,
  isBotAdmin: false,
  isGroupAdmin: false,
  isGuest,
  storageContextId: STORAGE_CTX,
  configContextId: CONFIG_CTX,
})

const interaction = (callbackData: string): IncomingInteraction => ({
  kind: 'button',
  user: { id: 'u1', username: null, isAdmin: false },
  contextId: STORAGE_CTX,
  contextType: 'dm',
  platformInstanceId: 'tg',
  storageContextId: STORAGE_CTX,
  callbackData,
})

describe('routeInteraction lang: callbacks', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('lang:ru from an authorized actor persists ru on the config context and clears language_prompted', async () => {
    setConfigValue(CONFIG_CTX, 'language_prompted', '1')
    const { reply, getReplies } = createMockReply()

    const handled = await routeInteraction(interaction('lang:ru'), reply, auth(true))

    expect(handled).toBe(true)
    expect(getConfigValue(CONFIG_CTX, 'language')).toBe('ru')
    expect(getConfigValue(CONFIG_CTX, 'language_prompted')).toBeNull()
    expect(getConfigValue(STORAGE_CTX, 'language')).toBeNull()
    expect(getReplies()[0]).toBe('Язык сохранён.')
  })

  test('lang:en from an authorized actor persists en and clears language_prompted', async () => {
    setConfigValue(CONFIG_CTX, 'language_prompted', '1')
    const { reply, getReplies } = createMockReply()

    const handled = await routeInteraction(interaction('lang:en'), reply, auth(true))

    expect(handled).toBe(true)
    expect(getConfigValue(CONFIG_CTX, 'language')).toBe('en')
    expect(getConfigValue(CONFIG_CTX, 'language_prompted')).toBeNull()
    expect(getReplies()[0]).toBe('Language saved.')
  })

  test('an unauthorized actor is rejected with a localized reply and nothing is persisted', async () => {
    setConfigValue(CONFIG_CTX, 'language', 'ru')
    const { reply, getReplies } = createMockReply()

    const handled = await routeInteraction(interaction('lang:ru'), reply, { ...auth(false), reason: 'dm_not_allowed' })

    expect(handled).toBe(true)
    expect(getReplies()[0]).toBe('Вы не авторизованы для работы с этим ботом.')
    expect(getConfigValue(CONFIG_CTX, 'language')).toBe('ru')
    expect(getConfigValue(STORAGE_CTX, 'language')).toBeNull()
  })

  test('a guest pressing the picker is a consumed no-op that persists nothing', async () => {
    setConfigValue(CONFIG_CTX, 'language_prompted', '1')
    const { reply, getReplies } = createMockReply()

    const handled = await routeInteraction(interaction('lang:ru'), reply, auth(true, true))

    expect(handled).toBe(true)
    expect(getConfigValue(CONFIG_CTX, 'language')).toBeNull()
    expect(getConfigValue(CONFIG_CTX, 'language_prompted')).toBe('1')
    expect(getReplies()).toEqual([])
  })

  test('an invalid locale is a consumed no-op', async () => {
    setConfigValue(CONFIG_CTX, 'language_prompted', '1')
    const { reply, getReplies } = createMockReply()

    const handled = await routeInteraction(interaction('lang:de'), reply, auth(true))

    expect(handled).toBe(true)
    expect(getConfigValue(CONFIG_CTX, 'language')).toBeNull()
    expect(getConfigValue(CONFIG_CTX, 'language_prompted')).toBe('1')
    expect(getReplies()).toEqual([])
  })

  test('an already-stored language is a no-op', async () => {
    setConfigValue(CONFIG_CTX, 'language', 'ru')
    setConfigValue(CONFIG_CTX, 'language_prompted', '1')
    const { reply, getReplies } = createMockReply()

    const handled = await routeInteraction(interaction('lang:ru'), reply, auth(true))

    expect(handled).toBe(true)
    expect(getConfigValue(CONFIG_CTX, 'language')).toBe('ru')
    expect(getConfigValue(CONFIG_CTX, 'language_prompted')).toBe('1')
    expect(getReplies()).toEqual([])
  })

  test('a different stored language is overwritten and acked in the new locale', async () => {
    setConfigValue(CONFIG_CTX, 'language', 'en')
    setConfigValue(CONFIG_CTX, 'language_prompted', '1')
    const { reply, getReplies } = createMockReply()

    const handled = await routeInteraction(interaction('lang:ru'), reply, auth(true))

    expect(handled).toBe(true)
    expect(getConfigValue(CONFIG_CTX, 'language')).toBe('ru')
    expect(getConfigValue(CONFIG_CTX, 'language_prompted')).toBeNull()
    expect(getReplies()[0]).toBe('Язык сохранён.')
  })
})
