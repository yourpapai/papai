// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { userCacheStore } from '../src/cache-store.js'
import type { UserCache } from '../src/cache-types.js'

const makeMinimalUserCache = (): UserCache => ({
  history: [],
  summary: null,
  facts: [],
  instructions: null,
  config: new Map(),
  workspaceId: null,
  tools: undefined,
  lastAccessed: Date.now(),
})

describe('userCacheStore', () => {
  test('is a Map instance', () => {
    expect(userCacheStore).toBeInstanceOf(Map)
  })

  test('allows setting, getting, and deleting values', () => {
    const key = '__test_cache_store__'
    userCacheStore.set(key, makeMinimalUserCache())
    expect(userCacheStore.has(key)).toBe(true)
    userCacheStore.delete(key)
    expect(userCacheStore.has(key)).toBe(false)
  })
})
