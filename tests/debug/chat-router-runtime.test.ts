// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import {
  clearRuntimeChatRouter,
  getRuntimeChatRouter,
  setRuntimeChatRouter,
} from '../../src/debug/chat-router-runtime.js'

describe('chat router runtime holder', () => {
  beforeEach(() => {
    clearRuntimeChatRouter()
  })

  test('stores and clears the active ChatRouter', () => {
    const router = new ChatRouter(() => {
      throw new Error('factory should not be called')
    })

    expect(getRuntimeChatRouter()).toBeNull()

    setRuntimeChatRouter(router)

    expect(getRuntimeChatRouter()).toBe(router)

    clearRuntimeChatRouter()

    expect(getRuntimeChatRouter()).toBeNull()
  })
})
