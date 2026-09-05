// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { resolveMaxTokens } from '../../src/model-context.js'
import { prewarmModelsDevSnapshot, resetModelsDevSnapshotForTest } from '../../src/models-dev/client.js'
import type { ModelMetadata, ModelMetadataInput, ModelsDevSnapshot } from '../../src/models-dev/resolve.js'
import { resolveModelMetadata } from '../../src/models-dev/resolve.js'

const fetchedAt = 1_700_000_000_000

const snapshotWith = (providers: ModelsDevSnapshot['providers']): ModelsDevSnapshot => ({
  fetchedAt,
  providers,
})

const emptySnapshot: ModelsDevSnapshot = { fetchedAt: null, providers: {} }

const catalogue: ModelsDevSnapshot = snapshotWith({
  openai: { models: { 'gpt-4o': { limit: { context: 128_000, output: 16_384 } } } },
  anthropic: { models: { 'claude-opus-4': { limit: { context: 200_000, output: 32_000 } } } },
  ollama: { models: { llama3: { limit: { context: 8_000 } } } },
})

const resolve = (input: ModelMetadataInput, snapshot: ModelsDevSnapshot = catalogue): ModelMetadata =>
  resolveModelMetadata(input, { getSnapshot: () => snapshot })

describe('resolveModelMetadata', () => {
  test('declared base references win over inference and the prefix table', () => {
    expect(
      resolve({
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        baseProvider: 'anthropic',
        baseModel: 'claude-opus-4',
        model: 'gpt-4o',
      }),
    ).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-opus-4',
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      source: 'models-dev',
      via: 'override',
    })
  })

  test('half-declared references do not constitute an override', () => {
    expect(resolve({ providerType: 'openai', baseModel: 'claude-opus-4', model: 'gpt-4o' })).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o',
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      source: 'models-dev',
      via: 'inferred',
    })
  })

  test('declared references missing from the snapshot skip inference and fall back to the prefix table', () => {
    expect(
      resolve({
        providerType: 'openai',
        baseProvider: 'anthropic',
        baseModel: 'not-in-catalogue',
        model: 'gpt-4o',
      }),
    ).toEqual({
      providerId: null,
      modelId: null,
      contextWindow: 128_000,
      maxOutputTokens: null,
      source: 'prefix-table',
      via: null,
    })
  })

  test('provider type infers the catalogue provider', () => {
    expect(resolve({ providerType: 'anthropic', model: 'claude-opus-4' })).toEqual({
      providerId: 'anthropic',
      modelId: 'claude-opus-4',
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      source: 'models-dev',
      via: 'inferred',
    })
  })

  test('inferred catalogue entry wins over the prefix table', () => {
    const snapshot = snapshotWith({
      openai: { models: { 'gpt-4o-turbo': { limit: { context: 999_000, output: 4_096 } } } },
    })
    expect(resolve({ providerType: 'openai', model: 'gpt-4o-turbo' }, snapshot)).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o-turbo',
      contextWindow: 999_000,
      maxOutputTokens: 4_096,
      source: 'models-dev',
      via: 'inferred',
    })
  })

  test('a scoped catalogue miss falls back to the prefix table rather than a cross-provider search', () => {
    expect(resolve({ providerType: 'ollama', model: 'gpt-4o' })).toEqual({
      providerId: null,
      modelId: null,
      contextWindow: 128_000,
      maxOutputTokens: null,
      source: 'prefix-table',
      via: null,
    })
  })

  test('an unmapped provider identity searches the catalogue by model name', () => {
    expect(resolve({ providerType: 'custom', baseUrl: 'https://gateway.example.com/v1', model: 'gpt-4o' })).toEqual({
      providerId: 'openai',
      modelId: 'gpt-4o',
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      source: 'models-dev',
      via: 'inferred',
    })
  })

  test('agreeing duplicate names resolve to the catalogue with a deterministic provider', () => {
    const snapshot = snapshotWith({
      beta: { models: { 'shared-model': { limit: { context: 100_000, output: 8_000 } } } },
      alpha: { models: { 'shared-model': { limit: { context: 100_000, output: 8_000 } } } },
    })
    expect(resolve({ model: 'shared-model' }, snapshot)).toEqual({
      providerId: 'alpha',
      modelId: 'shared-model',
      contextWindow: 100_000,
      maxOutputTokens: 8_000,
      source: 'models-dev',
      via: 'inferred',
    })
  })

  test('a custom gateway host pins the provider for an otherwise ambiguous name', () => {
    const snapshot = snapshotWith({
      openrouter: { models: { 'shared-model': { limit: { context: 100_000, output: 1_000 } } } },
      beta: { models: { 'shared-model': { limit: { context: 200_000, output: 2_000 } } } },
    })
    expect(
      resolve({ providerType: 'custom', baseUrl: 'https://openrouter.ai/api/v1', model: 'shared-model' }, snapshot),
    ).toEqual({
      providerId: 'openrouter',
      modelId: 'shared-model',
      contextWindow: 100_000,
      maxOutputTokens: 1_000,
      source: 'models-dev',
      via: 'inferred',
    })
  })

  test('disagreeing duplicate names fall back to the prefix table', () => {
    const snapshot = snapshotWith({
      alpha: { models: { 'gpt-4o': { limit: { context: 111_111, output: 1_000 } } } },
      beta: { models: { 'gpt-4o': { limit: { context: 222_222, output: 1_000 } } } },
    })
    expect(resolve({ model: 'gpt-4o' }, snapshot)).toEqual({
      providerId: null,
      modelId: null,
      contextWindow: 128_000,
      maxOutputTokens: null,
      source: 'prefix-table',
      via: null,
    })
  })

  test('duplicate names agreeing on context but disagreeing on output keep the window and drop the cap', () => {
    const snapshot = snapshotWith({
      alpha: { models: { 'shared-model': { limit: { context: 100_000, output: 1_000 } } } },
      beta: { models: { 'shared-model': { limit: { context: 100_000, output: 2_000 } } } },
    })
    expect(resolve({ model: 'shared-model' }, snapshot)).toEqual({
      providerId: 'alpha',
      modelId: 'shared-model',
      contextWindow: 100_000,
      maxOutputTokens: null,
      source: 'models-dev',
      via: 'inferred',
    })
  })

  test('a model unknown to both catalogue and prefix table resolves to none', () => {
    expect(resolve({ providerType: 'custom', baseUrl: 'https://gw.example.com/v1', model: 'mystery-model' })).toEqual({
      providerId: null,
      modelId: null,
      contextWindow: null,
      maxOutputTokens: null,
      source: 'none',
      via: null,
    })
  })

  test('an empty snapshot keeps the prefix table working', () => {
    expect(resolve({ model: 'claude-opus-4' }, emptySnapshot)).toEqual({
      providerId: null,
      modelId: null,
      contextWindow: 200_000,
      maxOutputTokens: null,
      source: 'prefix-table',
      via: null,
    })
  })

  test('an empty snapshot with declared references still falls back to the prefix table', () => {
    expect(resolve({ baseProvider: 'openai', baseModel: 'gpt-4o', model: 'gpt-4o' }, emptySnapshot)).toEqual({
      providerId: null,
      modelId: null,
      contextWindow: 128_000,
      maxOutputTokens: null,
      source: 'prefix-table',
      via: null,
    })
  })

  test('an empty snapshot resolves an unknown model to none', () => {
    expect(resolve({ providerType: 'openai', model: 'mystery-model' }, emptySnapshot)).toEqual({
      providerId: null,
      modelId: null,
      contextWindow: null,
      maxOutputTokens: null,
      source: 'none',
      via: null,
    })
  })
})

describe('resolveModelMetadata with the process snapshot default', () => {
  afterEach(() => {
    resetModelsDevSnapshotForTest()
  })

  test('reads the models.dev singleton when no snapshot getter is injected', async () => {
    const body = JSON.stringify({ acme: { models: { 'acme-ultra': { limit: { context: 123_456, output: 4_321 } } } } })
    const cachePath = `/tmp/opencode/models-dev-default-${crypto.randomUUID()}/models.json`
    await prewarmModelsDevSnapshot({ fetchImpl: () => Promise.resolve(body), cachePath, now: () => 1 })

    expect(resolveModelMetadata({ model: 'acme-ultra' })).toEqual({
      providerId: 'acme',
      modelId: 'acme-ultra',
      contextWindow: 123_456,
      maxOutputTokens: 4_321,
      source: 'models-dev',
      via: 'inferred',
    })

    resetModelsDevSnapshotForTest()
  })

  test('the name-only ceiling and the resolver agree for an ambiguous name', async () => {
    const body = JSON.stringify({
      alpha: { models: { 'shared-model': { limit: { context: 100_000, output: 1_000 } } } },
      beta: { models: { 'shared-model': { limit: { context: 100_000, output: 2_000 } } } },
    })
    await prewarmModelsDevSnapshot({
      fetchImpl: () => Promise.resolve(body),
      cachePath: `/tmp/opencode/models-dev-tiebreak-${crypto.randomUUID()}/models.json`,
      now: () => 1,
    })

    expect(resolveMaxTokens('shared-model')).toBe(100_000)
    expect(resolveModelMetadata({ model: 'shared-model' })).toMatchObject({
      contextWindow: 100_000,
      source: 'models-dev',
    })

    resetModelsDevSnapshotForTest()
  })
})
