// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getCachedTools, setCachedTools, userCachesForTesting } from '../../src/cache.js'
import {
  getContextSettings,
  listContextsByPlatformInstance,
  listContextsByTaskInstance,
  setContextSettings,
} from '../../src/instances/context-store.js'
import {
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

const buildGroupDescriptorCacheKey = (
  contextId: string,
  chatUserId: string,
  username: string,
  providerScope: 'provider-backed' | 'providerless',
  stagedScope: 'no-staged-download' | 'with-staged-download',
  resolverScope: 'no-resolver' | 'with-resolver' = 'no-resolver',
): string => `${providerScope}:${stagedScope}:${resolverScope}:${contextId}:${chatUserId}:${username}`

describe('context-store', () => {
  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    seedTestTaskInstance({ id: 'kaneo-default' })
    seedTestTaskInstance({ id: 'yt-default', type: 'youtrack' })
    seedTestTaskInstance({ id: 'tasks-main' })
    seedTestTaskInstance({ id: 'tasks-other', type: 'youtrack' })
  })

  test('set + get round-trips assignments', () => {
    setContextSettings({ contextId: 'u1', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    expect(getContextSettings('u1')).toEqual({
      contextId: 'u1',
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'tg-default',
    })
  })

  test('set is upsert (re-assignment replaces existing row)', () => {
    setContextSettings({ contextId: 'u1', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'u1', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })
    expect(getContextSettings('u1')?.taskInstanceId).toBe('yt-default')
  })

  test('setContextSettings clears cached tool sets for the context', () => {
    setCachedTools('provider-backed:no-staged-download:no-resolver:u1', { old_tool: {} })
    setCachedTools('providerless:with-staged-download:with-resolver:u1', { old_tool: {} })

    setContextSettings({ contextId: 'u1', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })

    expect(getCachedTools('provider-backed:no-staged-download:no-resolver:u1')).toBeUndefined()
    expect(getCachedTools('providerless:with-staged-download:with-resolver:u1')).toBeUndefined()
  })

  test('setContextSettings clears cached group-derived tool sets for the context', () => {
    const providerBackedKey = buildGroupDescriptorCacheKey(
      'group-1',
      'user-1',
      'alice',
      'provider-backed',
      'no-staged-download',
    )
    const providerlessKey = buildGroupDescriptorCacheKey(
      'group-1',
      'user-1',
      'alice',
      'providerless',
      'with-staged-download',
    )
    setCachedTools(providerBackedKey, { old_tool: {} })
    setCachedTools(providerlessKey, { old_tool: {} })

    setContextSettings({ contextId: 'group-1', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })

    expect(getCachedTools(providerBackedKey)).toBeUndefined()
    expect(getCachedTools(providerlessKey)).toBeUndefined()
  })

  test('get returns null for unknown context', () => {
    expect(getContextSettings('missing')).toBeNull()
  })

  test('listContextsByTaskInstance returns matching contexts only', () => {
    setContextSettings({ contextId: 'u1', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'u2', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'u3', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    const ids = listContextsByTaskInstance('kaneo-default')
      .map((c) => c.contextId)
      .toSorted()
    expect(ids).toEqual(['u1', 'u3'])
  })

  test('listContextsByPlatformInstance returns matching contexts only', () => {
    setContextSettings({ contextId: 'u1', taskInstanceId: 'kaneo-default', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'u2', taskInstanceId: 'kaneo-default', platformInstanceId: 'mm-default' })
    const ids = listContextsByPlatformInstance('mm-default').map((c) => c.contextId)
    expect(ids).toEqual(['u2'])
  })
})
