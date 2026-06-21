// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { emitGlobal, subscribeCountForTest } from '../../../src/debug/event-bus.js'
import { mockLogger, setupTestDb, waitFor } from '../../utils/test-helpers.js'

describe('membership subscriber', () => {
  let ensureCalls: Array<{ groupContextId: string; chatUserId: string }> = []
  let removeCalls: Array<{ groupContextId: string; chatUserId: string }> = []

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    ensureCalls = []
    removeCalls = []
  })

  test('registerMembershipSubscriber adds a global listener', async () => {
    const { registerMembershipSubscriber } = await import('../../../src/providers/membership/subscriber.js')
    const before = subscribeCountForTest()
    const unregister = registerMembershipSubscriber({
      ensure: (g, u) => {
        ensureCalls.push({ groupContextId: g, chatUserId: u })
        return Promise.resolve('created' as const)
      },
      markInactive: () => Promise.resolve(),
    })
    expect(subscribeCountForTest()).toBe(before + 1)
    unregister()
  })

  test('group_member:added triggers ensureWorkspaceMember', async () => {
    const { registerMembershipSubscriber } = await import('../../../src/providers/membership/subscriber.js')
    const unregister = registerMembershipSubscriber({
      ensure: (g, u) => {
        ensureCalls.push({ groupContextId: g, chatUserId: u })
        return Promise.resolve('created' as const)
      },
      markInactive: () => Promise.resolve(),
    })

    emitGlobal('group_member:added', { groupId: 'g-1', userId: 'u-1' })
    await waitFor(() => ensureCalls.length >= 1)

    expect(ensureCalls).toHaveLength(1)
    expect(ensureCalls[0]).toEqual({ groupContextId: 'g-1', chatUserId: 'u-1' })
    unregister()
  })

  test('group_member:added skips placeholder userIds', async () => {
    const { registerMembershipSubscriber } = await import('../../../src/providers/membership/subscriber.js')
    const unregister = registerMembershipSubscriber({
      ensure: (g, u) => {
        ensureCalls.push({ groupContextId: g, chatUserId: u })
        return Promise.resolve('skipped' as const)
      },
      markInactive: () => Promise.resolve(),
    })

    emitGlobal('group_member:added', { groupId: 'g-2', userId: 'placeholder-abc123' })
    // Wait a tick so the async handler has a chance to run (it won't, but we need to yield)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })

    expect(ensureCalls).toHaveLength(0)
    unregister()
  })

  test('group_member:removed calls markInactive', async () => {
    const { registerMembershipSubscriber } = await import('../../../src/providers/membership/subscriber.js')
    const unregister = registerMembershipSubscriber({
      ensure: () => Promise.resolve('skipped' as const),
      markInactive: (g, u) => {
        removeCalls.push({ groupContextId: g, chatUserId: u })
        return Promise.resolve()
      },
    })

    emitGlobal('group_member:removed', { groupId: 'g-3', userId: 'u-3' })
    await waitFor(() => removeCalls.length >= 1)

    expect(removeCalls).toHaveLength(1)
    expect(removeCalls[0]).toEqual({ groupContextId: 'g-3', chatUserId: 'u-3' })
    unregister()
  })
})
