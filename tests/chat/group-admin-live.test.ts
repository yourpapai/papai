// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  clearGroupAdminLiveCache,
  userManagesAuthorizedGroupLive,
  type GroupAdminLiveDeps,
} from '../../src/chat/group-admin-live.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { mockLogger } from '../utils/test-helpers.js'

const INSTANCE = 'inst-a'
const scoped = (nativeContextId: string, platformInstanceId = INSTANCE): string =>
  toScopedContextId({ platformInstanceId, nativeContextId })

const makeDeps = (groupIds: string[], nowMs = 1000): GroupAdminLiveDeps => ({
  listAuthorizedGroupIds: (): string[] => groupIds,
  now: (): number => nowMs,
})

describe('userManagesAuthorizedGroupLive', () => {
  beforeEach(() => {
    mockLogger()
    clearGroupAdminLiveCache()
  })

  test('returns false when the provider cannot do admin lookups', async () => {
    const result = await userManagesAuthorizedGroupLive({}, 'user1', INSTANCE, makeDeps([scoped('group1')]))
    expect(result).toBe(false)
  })

  test('returns true when the user is an admin of any authorized group on the instance', async () => {
    const isGroupAdmin = mock((_pi: string, groupId: string) => Promise.resolve(groupId === 'group2'))
    const result = await userManagesAuthorizedGroupLive(
      { isGroupAdmin },
      'user1',
      INSTANCE,
      makeDeps([scoped('group1'), scoped('group2')]),
    )
    expect(result).toBe(true)
  })

  test('returns false when the user is not an admin of any group', async () => {
    const isGroupAdmin = mock(() => Promise.resolve(false))
    const result = await userManagesAuthorizedGroupLive(
      { isGroupAdmin },
      'user1',
      INSTANCE,
      makeDeps([scoped('group1'), scoped('group2')]),
    )
    expect(result).toBe(false)
  })

  test('only queries authorized groups on the requested platform instance', async () => {
    const isGroupAdmin = mock((_pi: string, _groupId: string, _userId: string) => Promise.resolve(true))
    await userManagesAuthorizedGroupLive(
      { isGroupAdmin },
      'user1',
      INSTANCE,
      makeDeps([scoped('group1'), scoped('group2', 'other-instance'), 'not-a-scoped-id']),
    )
    const queriedGroupIds = isGroupAdmin.mock.calls.map((c) => c[1])
    expect(queriedGroupIds).toEqual(['group1'])
  })

  test('treats a thrown lookup as not-admin', async () => {
    const isGroupAdmin = mock(() => Promise.reject(new Error('boom')))
    const result = await userManagesAuthorizedGroupLive(
      { isGroupAdmin },
      'user1',
      INSTANCE,
      makeDeps([scoped('group1'), scoped('group2')]),
    )
    expect(result).toBe(false)
  })

  test('treats an unsupported (null) lookup as not-admin', async () => {
    const isGroupAdmin = mock(() => Promise.resolve(null))
    const result = await userManagesAuthorizedGroupLive(
      { isGroupAdmin },
      'user1',
      INSTANCE,
      makeDeps([scoped('group1'), scoped('group2')]),
    )
    expect(result).toBe(false)
  })

  test('caches the result within the TTL window', async () => {
    const isGroupAdmin = mock(() => Promise.resolve(true))
    const deps = makeDeps([scoped('group1')], 1000)

    const first = await userManagesAuthorizedGroupLive({ isGroupAdmin }, 'user1', INSTANCE, deps)
    const second = await userManagesAuthorizedGroupLive({ isGroupAdmin }, 'user1', INSTANCE, deps)

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(isGroupAdmin).toHaveBeenCalledTimes(1)
  })

  test('re-queries after the cache entry expires', async () => {
    const isGroupAdmin = mock(() => Promise.resolve(false))
    const group = scoped('group1')

    await userManagesAuthorizedGroupLive({ isGroupAdmin }, 'user1', INSTANCE, makeDeps([group], 1000))
    await userManagesAuthorizedGroupLive({ isGroupAdmin }, 'user1', INSTANCE, makeDeps([group], 1000 + 60_001))

    expect(isGroupAdmin).toHaveBeenCalledTimes(2)
  })

  test('returns false when there are no authorized groups for the instance', async () => {
    const isGroupAdmin = mock(() => Promise.resolve(true))
    const result = await userManagesAuthorizedGroupLive({ isGroupAdmin }, 'user1', INSTANCE, makeDeps([]))
    expect(result).toBe(false)
    expect(isGroupAdmin).not.toHaveBeenCalled()
  })
})
