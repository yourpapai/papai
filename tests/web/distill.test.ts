// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { setSystemConfig } from '../../src/system-config.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from '../utils/test-helpers.js'

const MAX_EXCERPT_CHARS = 8_000

const createLongContent = (): string => `Paragraph one summary candidate.\n\n${'A'.repeat(MAX_EXCERPT_CHARS + 100)}`

type DistillWebContent = (
  input: {
    storageContextId: string
    title: string
    content: string
    goal?: string
    contextType?: 'dm' | 'group'
    chatUserId?: string
  },
  deps?: {
    generateText: (options: {
      model: unknown
      prompt: string
      timeout: number
    }) => Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>
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

const seedSystemLlm = (
  overrides: Partial<{
    apiKey: string
    baseUrl: string
    mainModel: string
    smallModel: string
  }> = {},
): void => {
  resetSystemConfigCacheForTesting()
  setSystemConfig('llm_apikey', overrides.apiKey ?? 'test-key', 'env')
  setSystemConfig('llm_baseurl', overrides.baseUrl ?? 'https://llm.example', 'env')
  setSystemConfig('main_model', overrides.mainModel ?? 'main-model', 'env')
  if (overrides.smallModel !== undefined) {
    setSystemConfig('small_model', overrides.smallModel, 'env')
  }
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

    seedSystemLlm({ smallModel: 'small-model' })

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

    seedSystemLlm()

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

    seedSystemLlm()

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

  test('records a usage row with modelRole="small" when context fields are provided', async () => {
    const runDistill = getDistillWebContent(distillWebContent)

    seedSystemLlm({ smallModel: 'small-model' })

    await runDistill(
      {
        storageContextId: 'ctx-distill',
        contextType: 'group',
        chatUserId: 'user-distill',
        title: 'Big page',
        content: createLongContent(),
      },
      {
        buildModel: () => ({ id: 'small-model' }),
        generateText: () =>
          Promise.resolve({
            text: 'summary\n\nexcerpt',
            usage: { inputTokens: 30, outputTokens: 12 },
          }),
      },
    )

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.modelRole).toBe('small')
    expect(row?.model).toBe('small-model')
    expect(row?.storageContextId).toBe('ctx-distill')
    expect(row?.contextType).toBe('group')
    expect(row?.chatUserId).toBe('user-distill')
    expect(row?.inputTokens).toBe(30)
    expect(row?.outputTokens).toBe(12)
    expect(row?.messageCount).toBe(1)
    expect(row?.toolCallCount).toBe(0)
    expect(row?.stepCount).toBeGreaterThanOrEqual(1)
    expect(row?.error).toBeNull()
  })

  test('records an error row when generateText throws', async () => {
    const runDistill = getDistillWebContent(distillWebContent)

    seedSystemLlm({ smallModel: 'small-model' })

    await expect(
      runDistill(
        {
          storageContextId: 'ctx-fail',
          contextType: 'dm',
          chatUserId: 'user-fail',
          title: 'Big page',
          content: createLongContent(),
        },
        {
          buildModel: () => ({ id: 'small-model' }),
          generateText: () => Promise.reject(new Error('upstream down')),
        },
      ),
    ).rejects.toThrow('upstream down')

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row?.error).toBe('upstream down')
    expect(row?.modelRole).toBe('small')
    expect(row?.storageContextId).toBe('ctx-fail')
    expect(row?.contextType).toBe('dm')
    expect(row?.chatUserId).toBe('user-fail')
    expect(row?.inputTokens).toBeNull()
    expect(row?.outputTokens).toBeNull()
  })

  test('omits the row when context fields are absent', async () => {
    const runDistill = getDistillWebContent(distillWebContent)

    seedSystemLlm({ smallModel: 'small-model' })

    await runDistill(
      {
        storageContextId: 'ctx-no-context',
        title: 'Big page',
        content: createLongContent(),
      },
      {
        buildModel: () => ({ id: 'small-model' }),
        generateText: () => Promise.resolve({ text: 'summary\n\nexcerpt' }),
      },
    )

    const rows = getDrizzleDb().select().from(llmUsageEvents).all()
    expect(rows).toEqual([])
  })
})
