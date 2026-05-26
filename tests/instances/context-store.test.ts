// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getCachedTools, setCachedTools, userCachesForTesting } from '../../src/cache.js'
import {
  deleteContextsByPlatformInstance,
  deleteContextsByTaskInstance,
  getContextSettings,
  listContextsByPlatformInstance,
  listContextsByTaskInstance,
  setContextSettings,
} from '../../src/instances/context-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('context-store', () => {
  beforeEach(async () => {
    mockLogger()
    userCachesForTesting.clear()
    await setupTestDb()
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
    setCachedTools('u1', { old_tool: {} })

    setContextSettings({ contextId: 'u1', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })

    expect(getCachedTools('u1')).toBeUndefined()
  })

  test('setContextSettings clears cached group-derived tool sets for the context', () => {
    setCachedTools('group-1:user-1:alice', { old_tool: {} })

    setContextSettings({ contextId: 'group-1', taskInstanceId: 'yt-default', platformInstanceId: 'tg-default' })

    expect(getCachedTools('group-1:user-1:alice')).toBeUndefined()
  })

  test('deleteContextsByTaskInstance clears tool caches for deleted contexts', () => {
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'ctx-2', taskInstanceId: 'tasks-main', platformInstanceId: 'tg-default' })
    setCachedTools('ctx-1', { old_tool: {} })
    setCachedTools('ctx-2:user-1:alice', { old_tool: {} })

    expect(deleteContextsByTaskInstance('tasks-main')).toBe(2)

    expect(getCachedTools('ctx-1')).toBeUndefined()
    expect(getCachedTools('ctx-2:user-1:alice')).toBeUndefined()
  })

  test('deleteContextsByPlatformInstance clears tool caches for deleted contexts', () => {
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'tg-default' })
    setContextSettings({ contextId: 'ctx-2', taskInstanceId: 'tasks-other', platformInstanceId: 'tg-default' })
    setCachedTools('ctx-1', { old_tool: {} })
    setCachedTools('ctx-2:user-1:alice', { old_tool: {} })

    expect(deleteContextsByPlatformInstance('tg-default')).toBe(2)

    expect(getCachedTools('ctx-1')).toBeUndefined()
    expect(getCachedTools('ctx-2:user-1:alice')).toBeUndefined()
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
