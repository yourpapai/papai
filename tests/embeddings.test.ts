// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock, beforeEach, describe, expect, test } from 'bun:test'

import { enableByokForContext, updateByokLlmConfig } from '../src/byok-llm/store.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { llmUsageEvents } from '../src/db/schema.js'
import { getEmbedding, getEmbeddingForContext, tryGetEmbedding } from '../src/embeddings.js'
import { setSystemConfig } from '../src/system-config.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from './utils/test-helpers.js'

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

describe('getEmbeddingForContext', () => {
  let embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })
  let providerCalls: Array<{ apiKey: string; baseUrl: string }> = []
  let embedModels: string[] = []

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })
    providerCalls = []
    embedModels = []
    void mock.module('ai', () => ({
      embed: (..._args: unknown[]): Promise<EmbedResult> => embedImpl(),
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (opts: { apiKey: string; baseURL: string }): MockProvider => {
        providerCalls.push({ apiKey: opts.apiKey, baseUrl: opts.baseURL })
        return {
          embeddingModel: (name: string): string => {
            embedModels.push(name)
            return name
          },
        }
      },
    }))
  })

  test('uses BYOK embedding model for the enabled context without global config', async () => {
    updateByokLlmConfig(
      'ctx-byok-embedding',
      {
        llm_apikey: 'sk-byok-embedding',
        llm_baseurl: 'https://byok-embedding.invalid/v1',
        main_model: 'byok-main-embedding',
        embedding_model: 'byok-embed-model',
      },
      'admin-1',
    )
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.9, 0.8] })

    const result = await getEmbeddingForContext('hello', 'ctx-byok-embedding')

    expect(result).toEqual([0.9, 0.8])
    expect(providerCalls).toEqual([{ apiKey: 'sk-byok-embedding', baseUrl: 'https://byok-embedding.invalid/v1' }])
    expect(embedModels).toEqual(['byok-embed-model'])
  })

  test('returns null for incomplete BYOK without falling back to global config', async () => {
    enableByokForContext('ctx-byok-embedding-incomplete', 'admin-1')
    resetSystemConfigCacheForTesting()
    setSystemConfig('llm_apikey', 'sk-global-embedding', 'env')
    setSystemConfig('llm_baseurl', 'https://global-embedding.invalid/v1', 'env')
    setSystemConfig('main_model', 'global-main-embedding', 'env')
    setSystemConfig('embedding_model', 'global-embed-model', 'env')

    const result = await getEmbeddingForContext('hello', 'ctx-byok-embedding-incomplete')

    expect(result).toBeNull()
    expect(providerCalls).toHaveLength(0)
  })
})
