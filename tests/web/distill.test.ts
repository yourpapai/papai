// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../../src/cache.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const MAX_EXCERPT_CHARS = 8_000

const createLongContent = (): string => `Paragraph one summary candidate.\n\n${'A'.repeat(MAX_EXCERPT_CHARS + 100)}`

type DistillWebContent = (
  input: {
    storageContextId: string
    title: string
    content: string
    goal?: string
  },
  deps?: {
    generateText: (options: { model: unknown; prompt: string; timeout: number }) => Promise<{ text: string }>
    buildModel: (apiKey: string, baseUrl: string, modelId: string) => unknown
  },
) => Promise<{ summary: string; excerpt: string; truncated: boolean }>

const isDistillWebContent = (value: unknown): value is DistillWebContent => typeof value === 'function'
const getDistillWebContent = (value: unknown): DistillWebContent => {
  if (!isDistillWebContent(value)) {
    throw new Error('distillWebContent was not loaded')
  }
  return value
}

describe('distillWebContent', () => {
  let distillWebContent: unknown

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    ;({ distillWebContent } = await import('../../src/web/distill.js'))
  })

  test('bypasses the model for small content', async () => {
    const runDistill = getDistillWebContent(distillWebContent)

    setCachedConfig('ctx-1', 'llm_apikey', 'test-key')
    setCachedConfig('ctx-1', 'llm_baseurl', 'https://llm.example')
    setCachedConfig('ctx-1', 'small_model', 'small-model')

    let generateTextCalls = 0

    const result = await runDistill(
      {
        storageContextId: 'ctx-1',
        title: 'Small page',
        content: 'Short content',
      },
      {
        generateText: () => {
          generateTextCalls += 1
          return Promise.resolve({ text: 'should not run' })
        },
        buildModel: () => ({ mocked: true }),
      },
    )

    expect(generateTextCalls).toBe(0)
    expect(result).toEqual({
      summary: 'Short content',
      excerpt: 'Short content',
      truncated: false,
    })
  })

  test('falls back to main_model when small_model is missing', async () => {
    const runDistill = getDistillWebContent(distillWebContent)

    setCachedConfig('ctx-1', 'llm_apikey', 'test-key')
    setCachedConfig('ctx-1', 'llm_baseurl', 'https://llm.example')
    setCachedConfig('ctx-1', 'main_model', 'main-model')

    const builtModels: Array<{ apiKey: string; baseUrl: string; modelId: string }> = []
    const capturedModels: unknown[] = []

    const result = await runDistill(
      {
        storageContextId: 'ctx-1',
        title: 'Large page',
        content: createLongContent(),
      },
      {
        buildModel: (apiKey: string, baseUrl: string, modelId: string) => {
          builtModels.push({ apiKey, baseUrl, modelId })
          return { id: modelId }
        },
        generateText: ({ model }: { model: unknown; prompt: string; timeout: number }) => {
          capturedModels.push(model)
          return Promise.resolve({
            text: `Paragraph one summary candidate.\n\n${'B'.repeat(MAX_EXCERPT_CHARS + 50)}`,
          })
        },
      },
    )

    expect(builtModels).toEqual([
      {
        apiKey: 'test-key',
        baseUrl: 'https://llm.example',
        modelId: 'main-model',
      },
    ])
    expect(capturedModels).toEqual([{ id: 'main-model' }])
    expect(result.truncated).toBe(true)
    expect(result.summary).toContain('Paragraph one summary candidate.')
    expect(result.excerpt).toBe('B'.repeat(MAX_EXCERPT_CHARS))
  })

  test('uses a single-paragraph model response as both summary and excerpt', async () => {
    const runDistill = getDistillWebContent(distillWebContent)

    setCachedConfig('ctx-1', 'llm_apikey', 'test-key')
    setCachedConfig('ctx-1', 'llm_baseurl', 'https://llm.example')
    setCachedConfig('ctx-1', 'main_model', 'main-model')

    const result = await runDistill(
      {
        storageContextId: 'ctx-1',
        title: 'Large page',
        content: createLongContent(),
      },
      {
        buildModel: () => ({ id: 'main-model' }),
        generateText: () => Promise.resolve({ text: 'Single paragraph summary only' }),
      },
    )

    expect(result).toEqual({
      summary: 'Single paragraph summary only',
      excerpt: 'Single paragraph summary only',
      truncated: true,
    })
  })
})
