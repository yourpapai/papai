// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { getSessionSnapshots } from '../src/cache-snapshots.js'
import { userCachesForTesting } from '../src/cache.js'

// Local type matching UserCache from cache.ts
// Extended to allow extra properties that mapHistoryEntry checks for
type ExtendedModelMessage = ModelMessage & { tool_calls?: unknown; tool_call_id?: string }

type UserCache = {
  history: ExtendedModelMessage[]
  summary: string | null
  facts: Array<{ identifier: string; title: string; url: string; last_seen: string }>
  instructions: Array<{ id: string; text: string; createdAt: string }> | null
  config: Map<string, string | null>
  tools: unknown
  lastAccessed: number
}

describe('getSessionSnapshots', () => {
  beforeEach(() => {
    userCachesForTesting.clear()
  })

  test('returns empty array when no caches for user', () => {
    const snapshots = getSessionSnapshots('nonexistent-user')
    expect(snapshots).toHaveLength(0)
  })

  test('returns session with full data including config and instructions', () => {
    const userId = 'test-user-123'
    const cache: UserCache = {
      history: [
        { role: 'user', content: 'Hello' } as ModelMessage,
        { role: 'assistant', content: 'Hi there' } as ModelMessage,
      ],
      summary: 'Test conversation summary',
      facts: [
        {
          identifier: 'task-123',
          title: 'Example Task',
          url: 'https://example.com/task/123',
          last_seen: '2024-01-15T10:30:00.000Z',
        },
      ],
      instructions: [{ id: 'inst-1', text: 'Be helpful', createdAt: '2024-01-15T10:00:00.000Z' }],
      config: new Map([
        ['api_key', 'secret123'],
        ['model', 'gpt-4'],
        ['history_loaded', 'true'],
      ]),
      tools: {
        /* mock tools */
      },
      lastAccessed: Date.now(),
    }

    userCachesForTesting.set(userId, cache)

    const snapshots = getSessionSnapshots(userId)

    expect(snapshots).toHaveLength(1)
    const snapshot = snapshots[0]!
    expect(snapshot.userId).toBe(userId)
    expect(snapshot.historyLength).toBe(2)
    expect(snapshot.factsCount).toBe(1)
    expect(snapshot.summary).toBe('Test conversation summary')
    expect(snapshot.hasTools).toBe(true)
    expect(snapshot.instructionsCount).toBe(1)

    // Check full data fields
    expect(snapshot.config).toEqual({
      api_key: 'secret123',
      model: 'gpt-4',
    })
    expect(snapshot.facts).toHaveLength(1)
    expect(snapshot.facts[0]!.identifier).toBe('task-123')
    expect(snapshot.instructions).toHaveLength(1)
    expect(snapshot.instructions![0]!.text).toBe('Be helpful')

    // Check history is included
    expect(snapshot.history).toHaveLength(2)
    expect(snapshot.history[0]!.role).toBe('user')
    expect(snapshot.history[0]!.content).toBe('Hello')
    expect(snapshot.history[1]!.role).toBe('assistant')
  })

  test('filters out _loaded config keys', () => {
    const userId = 'test-user'
    const cache: UserCache = {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map([
        ['key1', 'value1'],
        ['history_loaded', 'true'],
        ['summary_loaded', 'true'],
        ['key2', 'value2'],
      ]),
      tools: null,
      lastAccessed: Date.now(),
    }

    userCachesForTesting.set(userId, cache)

    const snapshots = getSessionSnapshots(userId)

    expect(snapshots[0]!.configKeys).toEqual(['key1', 'key2'])
    expect(snapshots[0]!.config).toEqual({ key1: 'value1', key2: 'value2' })
  })

  test('returns null instructions when cache has none', () => {
    const userId = 'test-user'
    const cache: UserCache = {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map(),
      tools: null,
      lastAccessed: Date.now(),
    }

    userCachesForTesting.set(userId, cache)

    const snapshots = getSessionSnapshots(userId)

    expect(snapshots[0]!.instructions).toBeNull()
    expect(snapshots[0]!.instructionsCount).toBe(0)
  })

  test('returns hasTools as false when tools is null', () => {
    const userId = 'test-user'
    const cache: UserCache = {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map(),
      tools: null,
      lastAccessed: Date.now(),
    }

    userCachesForTesting.set(userId, cache)

    const snapshots = getSessionSnapshots(userId)

    expect(snapshots[0]!.hasTools).toBe(false)
  })

  test('maps history messages correctly', () => {
    const userId = 'test-user'
    // Use valid ModelMessage structures
    const userMsg: ModelMessage = { role: 'user', content: 'Hello' }
    const assistantMsg: ModelMessage = { role: 'assistant', content: 'Hi there' }
    const cache: UserCache = {
      history: [userMsg, assistantMsg],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map(),
      tools: null,
      lastAccessed: Date.now(),
    }

    userCachesForTesting.set(userId, cache)

    const snapshots = getSessionSnapshots(userId)

    expect(snapshots[0]!.history).toHaveLength(2)
    expect(snapshots[0]!.history[0]!.role).toBe('user')
    expect(snapshots[0]!.history[0]!.content).toBe('Hello')
    expect(snapshots[0]!.history[1]!.role).toBe('assistant')
    expect(snapshots[0]!.history[1]!.content).toBe('Hi there')
  })
})
