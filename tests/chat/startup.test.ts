// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { registerCommandMenuIfSupported } from '../../src/chat/startup.js'
import type { ChatCapability } from '../../src/chat/types.js'
import { createMockChat, mockLogger } from '../utils/test-helpers.js'

describe('registerCommandMenuIfSupported', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('calls setCommands when commands.menu capability is present', async () => {
    let called = false
    let calledWith: string | undefined
    const chat = createMockChat({
      capabilities: new Set<ChatCapability>(['commands.menu']),
      setCommands: (adminUserId: string): Promise<void> => {
        called = true
        calledWith = adminUserId
        return Promise.resolve()
      },
    })

    await registerCommandMenuIfSupported(chat, 'admin123')

    expect(called).toBe(true)
    expect(calledWith).toBe('admin123')
  })

  test('does not call setCommands when commands.menu capability is absent', async () => {
    let called = false
    const chat = createMockChat({
      capabilities: new Set<ChatCapability>(['messages.buttons', 'messages.files']),
      setCommands: (): Promise<void> => {
        called = true
        return Promise.resolve()
      },
    })

    await registerCommandMenuIfSupported(chat, 'admin123')

    expect(called).toBe(false)
  })

  test('handles provider with no setCommands method when capability present', async () => {
    const chat = {
      ...createMockChat({
        capabilities: new Set<ChatCapability>(['commands.menu']),
      }),
      setCommands: undefined,
    }

    await expect(registerCommandMenuIfSupported(chat, 'admin123')).resolves.toBeUndefined()
  })
})
