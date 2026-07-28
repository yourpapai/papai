// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { KonturTalkChatProvider } from '../../../src/chat/kontur-talk/index.js'
import type { ChatProvider } from '../../../src/chat/types.js'

// JWT token with sub="bot123" (base64-encoded payload: {"sub":"bot123","owner":"admin1","iat":1757061777})
const TEST_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJib3QxMjMiLCJvd25lciI6ImFkbWluMSIsImlhdCI6MTc1NzA2MTc3N30.test'

describe('kontur-talk inbound edit support (v1)', () => {
  const createProvider = (): ChatProvider =>
    new KonturTalkChatProvider({ jwtToken: TEST_JWT, platformInstanceId: 'kontur-main' })

  test('does not declare messages.edit.inbound capability', () => {
    const provider = createProvider()
    expect(provider.capabilities.has('messages.edit.inbound')).toBe(false)
  })

  test('does not implement onMessageEdit', () => {
    const provider = createProvider()
    expect(provider.onMessageEdit).toBeUndefined()
  })
})
