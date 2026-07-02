// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { ChatRouter } from '../../../src/chat/router.js'
import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../../src/debug/chat-router-runtime.js'
import { enrichMembers } from '../../../src/debug/settings/member-enrichment.js'
import { upsertGroupUserObservation } from '../../../src/group-settings/registry.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'

const mockResolveUserLabel = mock((_userId: string, _context?: unknown) => Promise.resolve<string | null>(null))

class MockChatRouter extends ChatRouter {
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }

  override resolveUserLabel(userId: string, context?: unknown): Promise<string | null> {
    return mockResolveUserLabel(userId, context)
  }
}

type Bare = { user_id: string; added_by: string; added_at: string }

const bareMember = (userId: string, addedBy = 'admin-1'): Bare => ({
  user_id: userId,
  added_by: addedBy,
  added_at: '2026-01-01T00:00:00.000Z',
})

/** Live-label resolver used by the "cache miss" test — kept out of the test body so the
 *  linter's no-conditional-in-test rule doesn't flag the branch. */
const resolveLiveOneLabel = (userId: string, _context?: unknown): Promise<string | null> =>
  Promise.resolve(userId === 'live-1' ? 'Live One' : null)

describe('enrichMembers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    mockResolveUserLabel.mockClear()
    mockResolveUserLabel.mockImplementation(() => Promise.resolve<string | null>(null))
  })

  afterEach(() => {
    clearRuntimeChatRouter()
  })

  test('resolves a cached label without needing a live chat router', async () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'grp-1' })
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId,
      userId: 'cached-1',
      username: 'c1',
      displayLabel: 'Cached One',
    })

    const [row] = await enrichMembers(contextId, [bareMember('cached-1')])
    expect(row?.user_label).toBe('Cached One')
    expect(row?.added_by_label).toBeNull()
  })

  test('falls back to the live resolver on a cache miss when a router is present', async () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'grp-1' })
    setRuntimeChatRouter(new MockChatRouter())
    mockResolveUserLabel.mockImplementation(resolveLiveOneLabel)

    const [row] = await enrichMembers(contextId, [bareMember('live-1', 'live-2')])
    expect(row?.user_label).toBe('Live One')
    expect(row?.added_by_label).toBeNull()
  })

  test('an unscoped contextId falls back to raw ids with null labels', async () => {
    const [row] = await enrichMembers('not-a-scoped-context-id', [bareMember('u-1')])
    expect(row?.user_label).toBeNull()
    expect(row?.added_by_label).toBeNull()
  })

  test('no router and no cache data yields null labels for every member', async () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'grp-1' })
    const result = await enrichMembers(contextId, [bareMember('u-1'), bareMember('u-2', 'u-1')])
    const labels = result.flatMap((m) => [m.user_label, m.added_by_label])
    expect(labels).toEqual([null, null, null, null])
  })
})
