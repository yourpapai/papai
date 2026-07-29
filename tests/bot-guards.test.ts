// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { resolveMessageAuth, shouldIgnoreGroupMessage } from '../src/bot-guards.js'
import { addUser } from '../src/users.js'
import {
  createDmMessage,
  createGroupMessage,
  mockLogger,
  seedTestPlatformInstance,
  setupTestDb,
} from './utils/test-helpers.js'

const PLATFORM_ID = 'test-instance'

describe('shouldIgnoreGroupMessage', () => {
  test('never ignores DMs', () => {
    expect(shouldIgnoreGroupMessage({ ...createDmMessage('u'), text: 'hi' })).toBe(false)
  })

  test('ignores a plain group message without mention or bot-reply', () => {
    const msg = {
      ...createGroupMessage('u', 'hi'),
      isMentioned: false,
      isReplyToBot: false,
      commandMatch: '',
    }
    expect(shouldIgnoreGroupMessage(msg)).toBe(true)
  })

  test('keeps a group message that mentions the bot', () => {
    const msg = {
      ...createGroupMessage('u', '@bot hi'),
      isMentioned: true,
      isReplyToBot: false,
      commandMatch: '',
    }
    expect(shouldIgnoreGroupMessage(msg)).toBe(false)
  })

  test('keeps a group message that replies to the bot', () => {
    const msg = {
      ...createGroupMessage('u', 'hi'),
      isMentioned: false,
      isReplyToBot: true,
      commandMatch: '',
    }
    expect(shouldIgnoreGroupMessage(msg)).toBe(false)
  })

  test('keeps a group command even without mention', () => {
    const msg = {
      ...createGroupMessage('u', '/stop'),
      isMentioned: false,
      isReplyToBot: false,
      commandMatch: 'stop',
    }
    expect(shouldIgnoreGroupMessage(msg)).toBe(false)
  })
})

describe('resolveMessageAuth', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_ID })
  })

  test('authorizes a registered user in DM', () => {
    addUser({ userId: 'auth-user', platformInstanceId: PLATFORM_ID, addedBy: 'admin' })
    const auth = resolveMessageAuth({
      ...createDmMessage('auth-user'),
      platformInstanceId: PLATFORM_ID,
    })
    expect(auth.allowed).toBe(true)
  })

  test('denies an unknown user in DM', () => {
    const auth = resolveMessageAuth({
      ...createDmMessage('stranger'),
      platformInstanceId: PLATFORM_ID,
    })
    expect(auth.allowed).toBe(false)
  })
})
