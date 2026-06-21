// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { userCacheStore } from '../src/cache-store.js'
import { clearCachedToolsByPrefix, getLatestCachedToolsForContext, setCachedTools } from '../src/cache.js'

const FAKE_TOOLS = { some_tool: { description: 'tool' } }

describe('clearCachedToolsByPrefix and getLatestCachedToolsForContext with resolver-scoped keys', () => {
  beforeEach(() => {
    // Clean up any test keys before each test
    for (const key of [...userCacheStore.keys()]) {
      if (key.startsWith('__test:') || key.startsWith('provider-backed:') || key.startsWith('providerless:')) {
        userCacheStore.delete(key)
      }
    }
  })

  test('clearCachedToolsByPrefix nulls a new-format key with with-resolver scope', () => {
    const contextId = '__test:ctx-resolver-1'
    const cacheKey = `provider-backed:no-staged-download:with-resolver:${contextId}:user1:`
    setCachedTools(cacheKey, FAKE_TOOLS)
    expect(userCacheStore.get(cacheKey)?.tools).not.toBeNull()

    clearCachedToolsByPrefix(contextId)

    expect(userCacheStore.get(cacheKey)?.tools).toBeNull()
  })

  test('clearCachedToolsByPrefix nulls a new-format key with no-resolver scope', () => {
    const contextId = '__test:ctx-resolver-2'
    const cacheKey = `provider-backed:no-staged-download:no-resolver:${contextId}:user1:`
    setCachedTools(cacheKey, FAKE_TOOLS)
    expect(userCacheStore.get(cacheKey)?.tools).not.toBeNull()

    clearCachedToolsByPrefix(contextId)

    expect(userCacheStore.get(cacheKey)?.tools).toBeNull()
  })

  test('clearCachedToolsByPrefix nulls a providerless new-format key with with-resolver scope', () => {
    const contextId = '__test:ctx-resolver-3'
    const cacheKey = `providerless:with-staged-download:with-resolver:${contextId}:user2:`
    setCachedTools(cacheKey, FAKE_TOOLS)
    expect(userCacheStore.get(cacheKey)?.tools).not.toBeNull()

    clearCachedToolsByPrefix(contextId)

    expect(userCacheStore.get(cacheKey)?.tools).toBeNull()
  })

  test('clearCachedToolsByPrefix nulls all 8 resolver-variant keys for a context', () => {
    const contextId = '__test:ctx-resolver-4'
    const providerScopes = ['provider-backed', 'providerless']
    const stagedScopes = ['no-staged-download', 'with-staged-download']
    const resolverScopes = ['no-resolver', 'with-resolver']
    const keys: string[] = []

    for (const ps of providerScopes) {
      for (const ss of stagedScopes) {
        for (const rs of resolverScopes) {
          const key = `${ps}:${ss}:${rs}:${contextId}:user1:`
          keys.push(key)
          setCachedTools(key, FAKE_TOOLS)
        }
      }
    }

    clearCachedToolsByPrefix(contextId)

    for (const key of keys) {
      expect(userCacheStore.get(key)?.tools).toBeNull()
    }
  })

  test('getLatestCachedToolsForContext finds a new-format key with with-resolver scope', () => {
    const contextId = '__test:ctx-resolver-5'
    const cacheKey = `provider-backed:no-staged-download:with-resolver:${contextId}:user1:`
    setCachedTools(cacheKey, FAKE_TOOLS)

    const result = getLatestCachedToolsForContext(contextId)

    expect(result).toEqual(FAKE_TOOLS)
  })

  test('getLatestCachedToolsForContext finds a new-format key with no-resolver scope', () => {
    const contextId = '__test:ctx-resolver-6'
    const cacheKey = `providerless:no-staged-download:no-resolver:${contextId}:user1:`
    setCachedTools(cacheKey, FAKE_TOOLS)

    const result = getLatestCachedToolsForContext(contextId)

    expect(result).toEqual(FAKE_TOOLS)
  })

  test('getLatestCachedToolsForContext returns undefined when only nulled-out new-format keys exist', () => {
    const contextId = '__test:ctx-resolver-7'
    const cacheKey = `provider-backed:no-staged-download:with-resolver:${contextId}:user1:`
    setCachedTools(cacheKey, FAKE_TOOLS)
    clearCachedToolsByPrefix(contextId)

    const result = getLatestCachedToolsForContext(contextId)

    expect(result).toBeUndefined()
  })
})
