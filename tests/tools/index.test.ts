// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getCachedTools, setCachedTools, userCachesForTesting } from '../../src/cache.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { makeTools } from '../../src/tools/index.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const CONTEXT = 'test-tool-prefs-index-user'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
})

afterEach(() => {
  userCachesForTesting.delete(CONTEXT)
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
    setToolPrefs(CONTEXT, { disabledDomains: ['memo'], toolOverrides: {} })
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
    setToolPrefs(parentContextId, { disabledDomains: ['memo'], toolOverrides: {} })

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
    setToolPrefs(CONTEXT, { disabledDomains: [], toolOverrides: { create_task: false } })
    const tools = await makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).not.toContain('create_task')
    expect(Object.keys(tools)).toContain('search_tasks')
  })

  test('clears cached parent and thread toolsets when parent preferences change', () => {
    const parentContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
    })
    const threadContextId = toScopedThreadContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'group-1',
      threadId: 'thread-1',
    })
    const parentCacheKey = `${parentContextId}:user-1:alice`
    const threadCacheKey = `${threadContextId}:user-1:alice`
    setCachedTools(parentCacheKey, { save_memo: {} })
    setCachedTools(threadCacheKey, { save_memo: {} })
    setCachedTools('other-context:user-1:alice', { save_memo: {} })

    setToolPrefs(parentContextId, { disabledDomains: ['memo'], toolOverrides: {} })

    expect(getCachedTools(parentCacheKey)).toBeUndefined()
    expect(getCachedTools(threadCacheKey)).toBeUndefined()
    expect(getCachedTools('other-context:user-1:alice')).toEqual({ save_memo: {} })
  })
})
