// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock, beforeEach, describe, expect, test } from 'bun:test'

import { enableByokForContext, updateByokLlmConfig } from '../src/byok-llm/store.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { llmUsageEvents } from '../src/db/schema.js'
import { embedManyTexts, getEmbedding, getEmbeddingForContext, tryGetEmbedding } from '../src/embeddings.js'
import { clearLlmAdminCacheForTesting } from '../src/llm-providers/store.testing.js'
import { mockLogger, seedAdminLlmBinding, setupTestDb } from './utils/test-helpers.js'

type EmbedResult = { embedding: number[]; usage?: { tokens: number } }
type EmbedManyResult = { embeddings: number[][]; usage?: { tokens: number } }
type MockProvider = { embeddingModel: (name: string) => string }
type EmbedOptionsSeen = { value?: string; maxRetries?: number; abortSignal?: AbortSignal }
type EmbedManyOptionsSeen = { values?: string[]; maxRetries?: number; abortSignal?: AbortSignal }

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

describe('getEmbedding call bounds', () => {
  let embedSeen: EmbedOptionsSeen[] = []

  beforeEach(() => {
    mockLogger()
    embedSeen = []
    void mock.module('ai', () => ({
      embed: (options: EmbedOptionsSeen): Promise<EmbedResult> => {
        embedSeen.push(options)
        return Promise.resolve({ embedding: [1] })
      },
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): MockProvider => ({
        embeddingModel: (name: string): string => name,
      }),
    }))
  })

  test('threads bounded maxRetries and a timeout abortSignal into embed()', async () => {
    await getEmbedding('bounded text', 'key', 'http://localhost', 'model')

    expect(embedSeen.length).toBe(1)
    expect(embedSeen[0]?.maxRetries).toBe(1)
    expect(embedSeen[0]?.abortSignal).toBeInstanceOf(AbortSignal)
  })
})

describe('embedManyTexts', () => {
  let embedManySeen: EmbedManyOptionsSeen[] = []
  let embedManyImpl = (): Promise<EmbedManyResult> => Promise.resolve({ embeddings: [[1]] })

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    embedManySeen = []
    embedManyImpl = (): Promise<EmbedManyResult> => Promise.resolve({ embeddings: [[1]] })
    void mock.module('ai', () => ({
      embedMany: (options: EmbedManyOptionsSeen): Promise<EmbedManyResult> => {
        embedManySeen.push(options)
        return embedManyImpl()
      },
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible: (): MockProvider => ({
        embeddingModel: (name: string): string => name,
      }),
    }))
  })

  test('returns embeddings and threads call bounds + values into embedMany', async () => {
    embedManyImpl = (): Promise<EmbedManyResult> =>
      Promise.resolve({
        embeddings: [
          [1, 0],
          [0, 1],
        ],
      })

    const out = await embedManyTexts(['alpha', 'beta'], 'key', 'http://localhost', 'model')

    expect(out).toEqual([
      [1, 0],
      [0, 1],
    ])
    expect(embedManySeen.length).toBe(1)
    expect(embedManySeen[0]?.values).toEqual(['alpha', 'beta'])
    expect(embedManySeen[0]?.maxRetries).toBe(1)
    expect(embedManySeen[0]?.abortSignal).toBeInstanceOf(AbortSignal)
  })

  test('records exactly one usage row per batch with batch tokens', async () => {
    embedManyImpl = (): Promise<EmbedManyResult> =>
      Promise.resolve({ embeddings: [[1], [2], [3]], usage: { tokens: 11 } })

    await embedManyTexts(['a', 'b', 'c'], 'key', 'http://localhost', 'embed-model', {
      storageContextId: 'subject-batch',
      contextType: 'dm',
      chatUserId: 'user-batch',
    })

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.modelRole).toBe('embedding')
    expect(row?.model).toBe('embed-model')
    expect(row?.storageContextId).toBe('subject-batch')
    expect(row?.chatUserId).toBe('user-batch')
    expect(row?.inputTokens).toBe(11)
    expect(row?.error).toBeNull()
  })

  test('records one failure row and rethrows when the batch throws', async () => {
    embedManyImpl = (): Promise<EmbedManyResult> => Promise.reject(new Error('batch down'))

    await expect(
      embedManyTexts(['a'], 'key', 'http://localhost', 'embed-model', {
        storageContextId: 'subject-batch-err',
        contextType: 'group',
        chatUserId: 'user-batch-err',
      }),
    ).rejects.toThrow('batch down')

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.error).toBe('batch down')
    expect(rows[0]?.storageContextId).toBe('subject-batch-err')
    expect(rows[0]?.inputTokens).toBeNull()
  })

  test('records a usage row with null tokens when the batch returns no usage', async () => {
    embedManyImpl = (): Promise<EmbedManyResult> => Promise.resolve({ embeddings: [[1], [2]] })

    await embedManyTexts(['a', 'b'], 'key', 'http://localhost', 'embed-model', {
      storageContextId: 'subject-batch-no-usage',
      contextType: 'dm',
      chatUserId: 'user-batch-no-usage',
    })

    const row = getDrizzleDb().select().from(llmUsageEvents).all()[0]
    expect(row?.inputTokens).toBeNull()
    expect(row?.error).toBeNull()
  })

  test('omits the usage row when no context is supplied', async () => {
    embedManyImpl = (): Promise<EmbedManyResult> => Promise.resolve({ embeddings: [[1]], usage: { tokens: 3 } })

    await embedManyTexts(['a'], 'key', 'http://localhost', 'embed-model')

    expect(getDrizzleDb().select().from(llmUsageEvents).all()).toEqual([])
  })

  test('rethrows the original batch error without a context and records nothing', async () => {
    embedManyImpl = (): Promise<EmbedManyResult> => Promise.reject(new Error('batch down'))

    await expect(embedManyTexts(['a'], 'key', 'http://localhost', 'model', undefined)).rejects.toThrow('batch down')

    expect(getDrizzleDb().select().from(llmUsageEvents).all()).toEqual([])
  })
})

describe('getEmbeddingForContext', () => {
  let embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.1, 0.2, 0.3] })
  let providerCalls: Array<{ apiKey: string; baseUrl: string }> = []
  let embedModels: string[] = []

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearLlmAdminCacheForTesting()
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

  test('uses BYOK embedding model for the enabled context (overriding admin)', async () => {
    seedAdminLlmBinding()
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

  test('falls back to admin config when BYOK is enabled but incomplete (graceful fallback)', async () => {
    seedAdminLlmBinding()
    enableByokForContext('ctx-byok-embedding-incomplete', 'admin-1')
    embedImpl = (): Promise<EmbedResult> => Promise.resolve({ embedding: [0.9, 0.8] })

    const result = await getEmbeddingForContext('hello', 'ctx-byok-embedding-incomplete')

    expect(result).toEqual([0.9, 0.8])
    expect(providerCalls).toEqual([{ apiKey: 'sk-admin', baseUrl: 'https://admin.invalid/v1' }])
  })
})
