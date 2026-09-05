// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  AdminLlmRolesResponseSchema,
  AdminProvidersResponseSchema,
  LlmModelMetadataResponseSchema,
  PROVIDER_TYPE_BASE_URLS,
  PublicProviderAccountSchema,
  VerificationSchema,
  fetchLlmModelMetadata,
} from '../../../client/settings/fetcher-schemas-llm-providers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

describe('LLM provider schemas', () => {
  test('parses a public provider account', () => {
    const parsed = PublicProviderAccountSchema.parse({
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      baseProvider: 'openai',
      baseModel: 'gpt-4o',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o'],
        modelsFetchedAt: 1717000000000,
      },
    })

    expect(parsed.id).toBe('prov_1')
    expect(parsed.baseProvider).toBe('openai')
    expect(parsed.baseModel).toBe('gpt-4o')
    expect(parsed.verification.status).toBe('verified')
    expect(parsed.verification.models).toEqual(['gpt-4o'])
  })

  test('parses a public provider account with null base references', () => {
    const parsed = PublicProviderAccountSchema.parse({
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      baseProvider: null,
      baseModel: null,
      verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
    })

    expect(parsed.baseProvider).toBeNull()
    expect(parsed.baseModel).toBeNull()
  })

  test('defaults absent base references to null', () => {
    const parsed = PublicProviderAccountSchema.parse({
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
    })

    expect(parsed.baseProvider).toBeNull()
    expect(parsed.baseModel).toBeNull()
  })

  test('rejects an unknown provider type', () => {
    expect(() =>
      PublicProviderAccountSchema.parse({
        id: 'prov_1',
        label: 'X',
        providerType: 'unknown',
        baseUrl: 'x',
        apiKeyMasked: '****x',
        baseProvider: null,
        baseModel: null,
        verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
      }),
    ).toThrow()
  })

  test('parses admin providers list response', () => {
    const parsed = AdminProvidersResponseSchema.parse({
      providers: [
        {
          id: 'prov_1',
          label: 'OpenAI',
          providerType: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyMasked: '****abcd',
          baseProvider: null,
          baseModel: null,
          verification: { status: 'verified', error: null, at: null, models: [], modelsFetchedAt: null },
        },
      ],
    })
    expect(parsed.providers).toHaveLength(1)
  })

  test('parses admin roles response', () => {
    const parsed = AdminLlmRolesResponseSchema.parse({
      roles: {
        main: { providerId: 'prov_1', model: 'gpt-4o' },
        small: null,
        embedding: null,
      },
    })
    expect(parsed.roles.main.model).toBe('gpt-4o')
    expect(parsed.roles.small).toBeNull()
  })

  test('PROVIDER_TYPE_BASE_URLS has presets for known types', () => {
    expect(PROVIDER_TYPE_BASE_URLS.openai).toBe('https://api.openai.com/v1')
    expect(PROVIDER_TYPE_BASE_URLS.ollama).toBe('http://localhost:11434/v1')
  })

  test('VerificationSchema accepts error status with message', () => {
    const parsed = VerificationSchema.parse({
      status: 'error',
      error: 'boom',
      at: 1,
      models: [],
      modelsFetchedAt: null,
    })
    expect(parsed.status).toBe('error')
    expect(parsed.error).toBe('boom')
  })
})

describe('LlmModelMetadataResponseSchema', () => {
  test('round-trips a catalogue hit payload', () => {
    const parsed = LlmModelMetadataResponseSchema.parse({
      providerId: 'openai',
      modelId: 'gpt-4o',
      contextWindow: 128_000,
      maxOutputTokens: 16_384,
      source: 'models-dev',
      via: 'inferred',
      snapshotFetchedAt: 1_700_000_000_000,
    })

    expect(parsed.source).toBe('models-dev')
    expect(parsed.via).toBe('inferred')
    expect(parsed.contextWindow).toBe(128_000)
    expect(parsed.maxOutputTokens).toBe(16_384)
    expect(parsed.snapshotFetchedAt).toBe(1_700_000_000_000)
  })

  test('accepts a none payload with a null snapshot fetch time', () => {
    const parsed = LlmModelMetadataResponseSchema.parse({
      providerId: null,
      modelId: null,
      contextWindow: null,
      maxOutputTokens: null,
      source: 'none',
      via: null,
      snapshotFetchedAt: null,
    })

    expect(parsed.source).toBe('none')
    expect(parsed.snapshotFetchedAt).toBeNull()
  })

  test('accepts an override payload', () => {
    const parsed = LlmModelMetadataResponseSchema.parse({
      providerId: 'anthropic',
      modelId: 'claude-declared',
      contextWindow: 200_000,
      maxOutputTokens: 8_000,
      source: 'models-dev',
      via: 'override',
      snapshotFetchedAt: 1,
    })

    expect(parsed.via).toBe('override')
  })

  test('rejects an unknown source', () => {
    expect(() =>
      LlmModelMetadataResponseSchema.parse({
        providerId: null,
        modelId: null,
        contextWindow: null,
        maxOutputTokens: null,
        source: 'guessed',
        via: null,
        snapshotFetchedAt: null,
      }),
    ).toThrow()
  })
})

describe('fetchLlmModelMetadata', () => {
  const metadataPayload = {
    providerId: 'openai',
    modelId: 'gpt-4o',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    source: 'models-dev',
    via: 'inferred',
    snapshotFetchedAt: 1_700_000_000_000,
  }

  test('GETs the lookup endpoint with the supplied params and parses the payload', async () => {
    const captured: { url: string; init: RequestInit }[] = []
    setMockFetch((url, init) => {
      captured.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify(metadataPayload), { status: 200 }))
    })

    const result = await fetchLlmModelMetadata({ providerType: 'openai', model: 'gpt-4o' })

    expect(result.source).toBe('models-dev')
    expect(captured[0]?.url).toBe('/settings/api/llm-model-metadata?providerType=openai&model=gpt-4o')
    expect(captured[0]?.init.method).toBeUndefined()
  })

  test('omits empty params and sends a bare path when nothing is supplied', async () => {
    const captured: { url: string }[] = []
    setMockFetch((url) => {
      captured.push({ url })
      return Promise.resolve(new Response(JSON.stringify({ ...metadataPayload, source: 'none' }), { status: 200 }))
    })

    await fetchLlmModelMetadata({ providerType: '', model: undefined })

    expect(captured[0]?.url).toBe('/settings/api/llm-model-metadata')
  })

  afterEach(() => {
    restoreFetch()
  })
})
