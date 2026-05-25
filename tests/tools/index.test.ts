// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { userCachesForTesting } from '../../src/cache.js'
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
  test('exposes lookup_group_history only for scoped thread context ids', () => {
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

    expect(makeTools(provider, { storageContextId: scopedThreadContextId, chatUserId: 'user-1' })).toHaveProperty(
      'lookup_group_history',
    )
    expect(makeTools(provider, { storageContextId: scopedMainContextId, chatUserId: 'user-1' })).not.toHaveProperty(
      'lookup_group_history',
    )
  })
})

describe('makeTools preference filtering', () => {
  test('returns the full set when no prefs are configured', () => {
    const provider = createMockProvider()
    const tools = makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).toContain('save_memo')
  })

  test('removes a tool whose domain is disabled', () => {
    const provider = createMockProvider()
    setToolPrefs(CONTEXT, { disabledDomains: ['memo'], toolOverrides: {} })
    const tools = makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).not.toContain('save_memo')
    expect(Object.keys(tools)).toContain('create_task')
  })

  test('honors a per-tool override that disables one tool in an enabled domain', () => {
    const provider = createMockProvider()
    setToolPrefs(CONTEXT, { disabledDomains: [], toolOverrides: { create_task: false } })
    const tools = makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).not.toContain('create_task')
    expect(Object.keys(tools)).toContain('search_tasks')
  })
})
