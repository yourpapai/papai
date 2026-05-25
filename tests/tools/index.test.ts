// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { userCachesForTesting } from '../../src/cache.js'
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

describe('makeTools preference filtering', () => {
  it('returns the full set when no prefs are configured', () => {
    const provider = createMockProvider()
    const tools = makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).toContain('create_task')
    expect(Object.keys(tools)).toContain('save_memo')
  })

  it('removes a tool whose domain is disabled', () => {
    const provider = createMockProvider()
    setToolPrefs(CONTEXT, { disabledDomains: ['memo'], toolOverrides: {} })
    const tools = makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).not.toContain('save_memo')
    expect(Object.keys(tools)).toContain('create_task')
  })

  it('honors a per-tool override that disables one tool in an enabled domain', () => {
    const provider = createMockProvider()
    setToolPrefs(CONTEXT, { disabledDomains: [], toolOverrides: { create_task: false } })
    const tools = makeTools(provider, {
      storageContextId: CONTEXT,
      chatUserId: CONTEXT,
      contextType: 'dm',
    })
    expect(Object.keys(tools)).not.toContain('create_task')
    expect(Object.keys(tools)).toContain('search_tasks')
  })
})
