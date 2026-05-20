// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock, beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../src/db/drizzle.js'
import { llmUsageEvents } from '../src/db/schema.js'
import { getEmbedding, tryGetEmbedding } from '../src/embeddings.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

type EmbedResult = { embedding: number[]; usage?: { tokens: number } }
type MockProvider = { embeddingModel: (name: string) => string }

describe('getEmbedding', () => {
  let embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })

  beforeEach(() => {
    mockLogger()
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })
    void mock.module('ai', () => ({
      embed: (..._args: unknown[]): Promise<EmbedResult> => embedImpl(),
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): MockProvider => ({
        embeddingModel: (name: string): string => name,
      }),
    }))
  })

  test('returns embedding array from embed()', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.5, 0.6, 0.7] })
    const result = await getEmbedding('test text', 'key', 'http://localhost', 'model')
    expect(result).toEqual([0.5, 0.6, 0.7])
  })

  test('rethrows errors from embed()', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.reject(new Error('API error'))
    await expect(getEmbedding('test', 'key', 'http://localhost', 'model')).rejects.toThrow('API error')
  })
})

describe('tryGetEmbedding', () => {
  let embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })
    void mock.module('ai', () => ({
      embed: (..._args: unknown[]): Promise<EmbedResult> => embedImpl(),
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): MockProvider => ({
        embeddingModel: (name: string): string => name,
      }),
    }))
  })

  test('returns embedding on success', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [1, 2, 3] })
    const result = await tryGetEmbedding('test', 'key', 'http://localhost', 'model')
    expect(result).toEqual([1, 2, 3])
  })

  test('returns null when embed() throws', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.reject(new Error('Network error'))
    const result = await tryGetEmbedding('test', 'key', 'http://localhost', 'model')
    expect(result).toBeNull()
  })

  test('records a usage row with input tokens when usage is returned', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [1, 2, 3], usage: { tokens: 42 } })
    await tryGetEmbedding('hi', 'key', 'http://localhost', 'embed-model', {
      storageContextId: 'subject-1',
      contextType: 'dm',
      chatUserId: 'user-1',
    })

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.modelRole).toBe('embedding')
    expect(row?.model).toBe('embed-model')
    expect(row?.storageContextId).toBe('subject-1')
    expect(row?.contextType).toBe('dm')
    expect(row?.chatUserId).toBe('user-1')
    expect(row?.inputTokens).toBe(42)
    expect(row?.outputTokens).toBeNull()
    expect(row?.stepCount).toBe(0)
    expect(row?.toolCallCount).toBe(0)
    expect(row?.messageCount).toBe(0)
    expect(row?.error).toBeNull()
  })

  test('records a usage row with null tokens when usage is missing', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [1, 2, 3] })
    await tryGetEmbedding('hi', 'key', 'http://localhost', 'embed-model', {
      storageContextId: 'subject-2',
      contextType: 'dm',
      chatUserId: 'user-2',
    })

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.inputTokens).toBeNull()
  })

  test('records a usage row with error populated when embed() throws', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.reject(new Error('boom'))
    const result = await tryGetEmbedding('hi', 'key', 'http://localhost', 'embed-model', {
      storageContextId: 'subject-err',
      contextType: 'group',
      chatUserId: 'user-err',
    })
    expect(result).toBeNull()

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.error).toBe('boom')
    expect(row?.modelRole).toBe('embedding')
    expect(row?.storageContextId).toBe('subject-err')
    expect(row?.contextType).toBe('group')
    expect(row?.chatUserId).toBe('user-err')
    expect(row?.inputTokens).toBeNull()
  })

  test('omits the usage row when no context is supplied', async () => {
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [1, 2, 3], usage: { tokens: 5 } })
    await tryGetEmbedding('hi', 'key', 'http://localhost', 'embed-model')

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toEqual([])
  })
})
