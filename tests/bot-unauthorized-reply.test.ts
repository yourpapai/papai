// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getUnauthorizedReplyText, replyToUnauthorized } from '../src/bot-unauthorized-reply.js'
import type { AuthorizationDenyReason, AuthorizationResult } from '../src/chat/types.js'
import { createMockReply } from './utils/test-helpers.js'

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
