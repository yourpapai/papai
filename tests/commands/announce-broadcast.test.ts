// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { broadcastMessage } from '../../src/commands/announce-broadcast.js'
import { addUser } from '../../src/users.js'
import { createMockChat, mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

describe('broadcastMessage', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    addUser({ userId: 'u-2', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
  })

  test('sends to every authorized user and returns counts', async () => {
    const sentUserIds: string[] = []
    const chat = createMockChat({
      sendMessage: (_platformInstanceId, target, _text) => {
        sentUserIds.push(target.contextId)
        return Promise.resolve()
      },
    })
    const result = await broadcastMessage(chat, 'pi-1', 'hello')
    expect(result.totalUsers).toBe(2)
    expect(result.successCount).toBe(2)
    expect(result.failCount).toBe(0)
    expect(sentUserIds.length).toBe(2)
  })

  test('returns zero counts when there are no users', async () => {
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    const chat = createMockChat()
    const result = await broadcastMessage(chat, 'pi-1', 'hello')
    expect(result.totalUsers).toBe(0)
    expect(result.successCount).toBe(0)
    expect(result.failCount).toBe(0)
  })
})
