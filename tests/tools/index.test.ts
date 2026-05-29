// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getCachedTools, setCachedTools, userCachesForTesting } from '../../src/cache.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { setConfigValue, setPluginConfig } from '../../src/config.js'
import { setPluginEnabledForContext } from '../../src/plugins/registry.js'
import { makeTools } from '../../src/tools/index.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CONTEXT = 'test-tool-prefs-index-user'
const OTHER_CACHE_KEY = 'other-context:user-1:alice'

type CacheInvalidationFixtures = Readonly<{
  parentContextId: string
  threadContextId: string
  parentCacheKey: string
  threadCacheKey: string
}>

const getCacheInvalidationFixtures = (): CacheInvalidationFixtures => {
  const parentContextId = toScopedContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
  })
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: 'thread-1',
  })
  return {
    parentContextId,
    threadContextId,
    parentCacheKey: `${parentContextId}:user-1:alice`,
    threadCacheKey: `${threadContextId}:user-1:alice`,
  }
}

const seedParentThreadAndUnrelatedToolCaches = (): CacheInvalidationFixtures => {
  const fixtures = getCacheInvalidationFixtures()
  setCachedTools(fixtures.parentCacheKey, { save_memo: {} })
  setCachedTools(fixtures.threadCacheKey, { save_memo: {} })
  setCachedTools(OTHER_CACHE_KEY, { save_memo: {} })
  return fixtures
}

const expectParentThreadCachesCleared = (parentCacheKey: string, threadCacheKey: string): void => {
  expect(getCachedTools(parentCacheKey)).toBeUndefined()
  expect(getCachedTools(threadCacheKey)).toBeUndefined()
  expect(getCachedTools(OTHER_CACHE_KEY)).toEqual({ save_memo: {} })
}

beforeEach(async () => {
  userCachesForTesting.clear()
  mockLogger()
  await setupTestDb()
})

afterEach(() => {
  userCachesForTesting.clear()
})

describe('makeTools', () => {
  test('exposes lookup_group_history only for scoped thread context ids', async () => {
    const provider = createMockProvider()
    const scopedMainContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
    })
    const scopedThreadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-1',
    })

    expect(await makeTools(provider, { storageContextId: scopedThreadContextId, chatUserId: 'user-1' })).toHaveProperty(
      'lookup_group_history',
    )
    expect(
      await makeTools(provider, { storageContextId: scopedMainContextId, chatUserId: 'user-1' }),
    ).not.toHaveProperty('lookup_group_history')
  })
})

describe('makeTools preference filtering', () => {
  test('returns the full set when no prefs are configured', async () => {
    const provider = createMockProvider()
    const tools = await makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).toContain('save_memo')
  })

  test('removes a tool whose domain is disabled', async () => {
    const provider = createMockProvider()
    setToolPrefs(CONTEXT, { domainDefaults: { memo: 'deny' }, toolOverrides: {} })
    const tools = await makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).not.toContain('save_memo')
    expect(Object.keys(tools)).toContain('create_task')
  })

  test('applies parent group tool preferences in thread context', async () => {
    const provider = createMockProvider()
    const parentContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
    })
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-1',
    })
    setToolPrefs(parentContextId, { domainDefaults: { memo: 'deny' }, toolOverrides: {} })

    const tools = await makeTools(provider, {
      storageContextId: threadContextId,
      chatUserId: 'user-1',
      contextType: 'group',
    })

    expect(Object.keys(tools)).not.toContain('save_memo')
    expect(Object.keys(tools)).not.toContain('search_memos')
    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).toContain('lookup_group_history')
  })

  test('honors a per-tool override that disables one tool in an enabled domain', async () => {
    const provider = createMockProvider()
    setToolPrefs(CONTEXT, { domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
    const tools = await makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).not.toContain('create_task')
    expect(Object.keys(tools)).toContain('search_tasks')
  })

  test('clears cached parent and thread toolsets when parent preferences change', () => {
    const { parentContextId, parentCacheKey, threadCacheKey } = seedParentThreadAndUnrelatedToolCaches()

    setToolPrefs(parentContextId, { domainDefaults: { memo: 'deny' }, toolOverrides: {} })

    expectParentThreadCachesCleared(parentCacheKey, threadCacheKey)
  })

  test('clears cached parent and thread toolsets when parent plugin enablement changes', () => {
    const { parentContextId, parentCacheKey, threadCacheKey } = seedParentThreadAndUnrelatedToolCaches()

    setPluginEnabledForContext('hello-world', parentContextId, true)

    expectParentThreadCachesCleared(parentCacheKey, threadCacheKey)
  })

  test('clears cached parent and thread toolsets when parent plugin config changes', () => {
    const { parentContextId, parentCacheKey, threadCacheKey } = seedParentThreadAndUnrelatedToolCaches()

    setPluginConfig(parentContextId, 'hello-world', 'greeting', 'hi')

    expectParentThreadCachesCleared(parentCacheKey, threadCacheKey)
  })

  test('clears cached parent and thread toolsets when parent MCP endpoints config changes', () => {
    const { parentContextId, parentCacheKey, threadCacheKey } = seedParentThreadAndUnrelatedToolCaches()

    setConfigValue(parentContextId, 'mcp_endpoints', '[]')

    expectParentThreadCachesCleared(parentCacheKey, threadCacheKey)
  })
})
