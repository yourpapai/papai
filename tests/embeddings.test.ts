// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock, beforeEach, describe, expect, test } from 'bun:test'

import { getEmbedding, tryGetEmbedding } from '../src/embeddings.js'
import { mockLogger } from './utils/test-helpers.js'

type EmbedResult = { embedding: number[] }
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
})
