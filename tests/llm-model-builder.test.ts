// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { z } from 'zod'

import { buildChatModel, getOpenAICompatibleProvider, type ModelBuilderDeps } from '../src/llm-model-builder.js'
import { clearModelBuilderCacheForTesting } from '../src/llm-model-builder.testing.js'
import type { ModelMetadata } from '../src/models-dev/resolve.js'
import { fetchWithoutTimeout } from '../src/utils/fetch.js'
import { restoreFetch, setMockFetch } from './utils/test-helpers.js'

function makeDeps(): { create: ReturnType<typeof mock>; deps: ModelBuilderDeps } {
  const create = mock((opts: Parameters<typeof createOpenAICompatible>[0]) => createOpenAICompatible(opts))
  return { create, deps: { create } }
}

describe('llm-model-builder', () => {
  beforeEach(() => {
    clearModelBuilderCacheForTesting()
  })

  it('memoizes the provider per apiKey+baseUrl', () => {
    const { create, deps } = makeDeps()
    const a = getOpenAICompatibleProvider('k1', 'http://x', deps)
    const b = getOpenAICompatibleProvider('k1', 'http://x', deps)
    expect(b).toBe(a)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('wires fetchWithoutTimeout into the provider', () => {
    const { create, deps } = makeDeps()
    getOpenAICompatibleProvider('k1', 'http://x', deps)
    expect(create.mock.calls[0]![0]).toMatchObject({ apiKey: 'k1', baseURL: 'http://x', fetch: fetchWithoutTimeout })
  })

  it('creates distinct providers for different credentials', () => {
    const { create, deps } = makeDeps()
    const a = getOpenAICompatibleProvider('k1', 'http://x', deps)
    const b = getOpenAICompatibleProvider('k2', 'http://x', deps)
    expect(b).not.toBe(a)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest provider past the cap', () => {
    for (let i = 0; i < 32; i++) getOpenAICompatibleProvider(`k${i}`, 'http://x')
    getOpenAICompatibleProvider('k-extra', 'http://x')
    const { create, deps } = makeDeps()
    getOpenAICompatibleProvider('k0', 'http://x', deps)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('does not collide when the apiKey contains a colon', () => {
    const { create, deps } = makeDeps()
    const a = getOpenAICompatibleProvider('user:password', 'https://api', deps)
    const b = getOpenAICompatibleProvider('user', 'password:https://api', deps)
    expect(b).not.toBe(a)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('buildChatModel returns a model bound to the requested model name', () => {
    const model = buildChatModel('k1', 'http://x', 'small-model-1')
    expect(model).toMatchObject({ modelId: 'small-model-1' })
  })
})

describe('buildChatModel with metadata', () => {
  beforeEach(() => {
    clearModelBuilderCacheForTesting()
  })

  afterEach(() => {
    restoreFetch()
  })

  const metadata = (over: Partial<ModelMetadata> = {}): ModelMetadata => ({
    providerId: 'openai',
    modelId: 'm1',
    contextWindow: 100_000,
    maxOutputTokens: 777,
    source: 'models-dev',
    via: 'inferred',
    ...over,
  })

  const chatCompletionResponse = (): Response =>
    new Response(
      JSON.stringify({
        id: 'chatcmpl-1',
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )

  const captureBodies = (): { raw: string[]; json: () => Record<string, unknown>[] } => {
    const raw: string[] = []
    const parseBody = (body: string): Record<string, unknown> =>
      z.record(z.string(), z.unknown()).catch({}).parse(JSON.parse(body))
    setMockFetch((_url, init) => {
      raw.push(typeof init.body === 'string' ? init.body : '')
      return Promise.resolve(chatCompletionResponse())
    })
    return { raw, json: () => raw.map(parseBody) }
  }

  it("a known model's generation request carries the catalogue maxOutputTokens", async () => {
    const captured = captureBodies()

    await generateText({ model: buildChatModel('k1', 'http://x', 'm1', undefined, metadata()), prompt: 'hi' })

    expect(captured.json()[0]?.['max_tokens']).toBe(777)
  })

  it("an override entry's cap is honored", async () => {
    const captured = captureBodies()

    await generateText({
      model: buildChatModel(
        'k1',
        'http://x',
        'gateway-model',
        undefined,
        metadata({ providerId: 'anthropic', modelId: 'claude-declared', maxOutputTokens: 4_000, via: 'override' }),
      ),
      prompt: 'hi',
    })

    expect(captured.json()[0]?.['max_tokens']).toBe(4_000)
  })

  it('a none model sends byte-identical requests with and without the metadata argument', async () => {
    const captured = captureBodies()

    await generateText({ model: buildChatModel('k1', 'http://x', 'm1'), prompt: 'hi' })
    const plainBody = captured.raw[0]
    await generateText({
      model: buildChatModel('k1', 'http://x', 'm1', undefined, {
        providerId: null,
        modelId: null,
        contextWindow: null,
        maxOutputTokens: null,
        source: 'none',
        via: null,
      }),
      prompt: 'hi',
    })

    expect(captured.raw[1]).toBe(plainBody)
  })

  it('the (apiKey, baseUrl) provider cache is untouched by metadata', async () => {
    const { create, deps } = makeDeps()
    const captured = captureBodies()

    const first = buildChatModel('k1', 'http://x', 'm1', deps, metadata({ maxOutputTokens: 111 }))
    const second = buildChatModel('k1', 'http://x', 'm1', deps, metadata({ maxOutputTokens: 222 }))

    expect(create).toHaveBeenCalledTimes(1)
    expect(second).not.toBe(first)

    await generateText({ model: first, prompt: 'hi' })
    await generateText({ model: second, prompt: 'hi' })

    expect(captured.json()[0]?.['max_tokens']).toBe(111)
    expect(captured.json()[1]?.['max_tokens']).toBe(222)
  })
})
