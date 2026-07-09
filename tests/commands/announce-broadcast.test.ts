// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { broadcastMessage } from '../../src/commands/announce-broadcast.js'
import * as proactiveHistoryModule from '../../src/proactive-history.js'
import { addUser } from '../../src/users.js'
import * as usersModule from '../../src/users.js'
import type { UserRecord } from '../../src/users.js'
import { createMockChat, mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

describe('broadcastMessage', () => {
  const spies: Array<{ mockRestore: () => void }> = []

  const track = <T extends { mockRestore: () => void }>(spy: T): T => {
    spies.push(spy)
    return spy
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    addUser({ userId: 'u-2', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
  })

  afterEach(() => {
    for (const spy of spies) spy.mockRestore()
    spies.length = 0
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

  test('records each successfully delivered broadcast into the recipient scoped history', async () => {
    const mockUsers: UserRecord[] = [
      {
        platform_user_id: 'u1',
        platform_instance_id: 'inst',
        username: null,
        added_at: '2026-01-01T00:00:00.000Z',
        added_by: 'admin',
        blocked_at: null,
      },
      {
        platform_user_id: 'u2',
        platform_instance_id: 'inst',
        username: null,
        added_at: '2026-01-01T00:00:00.000Z',
        added_by: 'admin',
        blocked_at: null,
      },
    ]
    track(spyOn(usersModule, 'listUsers').mockReturnValue(mockUsers))

    const recordCalls: Array<[string, string]> = []
    track(
      spyOn(proactiveHistoryModule, 'recordProactiveInHistory').mockImplementation((storageContextId, markdown) => {
        recordCalls.push([storageContextId, markdown])
      }),
    )

    const chat = createMockChat({
      sendMessage: (_platformInstanceId, _target, _text) => Promise.resolve(true),
    })

    await broadcastMessage(chat, 'inst', 'Heads up everyone')

    const expectedCalls: Array<[string, string]> = [
      [toScopedContextId({ platformInstanceId: 'inst', nativeContextId: 'u1' }), 'Heads up everyone'],
      [toScopedContextId({ platformInstanceId: 'inst', nativeContextId: 'u2' }), 'Heads up everyone'],
    ]
    const byFirstElement = (a: [string, string], b: [string, string]): number => a[0].localeCompare(b[0])
    expect(recordCalls.sort(byFirstElement)).toEqual(expectedCalls.sort(byFirstElement))
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
