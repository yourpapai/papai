// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { willQueueAuthorizedMessage } from '../../src/chat/queue-policy.js'
import type { AuthorizationResult, IncomingMessage } from '../../src/chat/types.js'

const auth = (overrides: Partial<AuthorizationResult>): AuthorizationResult => ({
  allowed: true,
  isBotAdmin: false,
  isGroupAdmin: false,
  storageContextId: 'ctx-1',
  configContextId: 'ctx-1',
  ...overrides,
})

const message = (overrides: Partial<IncomingMessage>): IncomingMessage => ({
  user: { id: 'u1', username: null, isAdmin: false },
  contextId: 'u1',
  contextType: 'dm',
  isMentioned: false,
  text: 'hi',
  platformInstanceId: 'tg-default',
  ...overrides,
})

describe('willQueueAuthorizedMessage', () => {
  test('false when not allowed', () => {
    expect(willQueueAuthorizedMessage(message({}), auth({ allowed: false }))).toBe(false)
  })

  test('true for an authorized DM', () => {
    expect(willQueueAuthorizedMessage(message({ contextType: 'dm' }), auth({}))).toBe(true)
  })

  test('true for a group command', () => {
    expect(willQueueAuthorizedMessage(message({ contextType: 'group', commandMatch: 'stop' }), auth({}))).toBe(true)
  })

  test('true for a group mention', () => {
    expect(willQueueAuthorizedMessage(message({ contextType: 'group', isMentioned: true }), auth({}))).toBe(true)
  })

  test('true for a group reply-to-bot', () => {
    expect(willQueueAuthorizedMessage(message({ contextType: 'group', isReplyToBot: true }), auth({}))).toBe(true)
  })

  test('false for an unaddressed group message', () => {
    expect(willQueueAuthorizedMessage(message({ contextType: 'group' }), auth({}))).toBe(false)
  })
})
