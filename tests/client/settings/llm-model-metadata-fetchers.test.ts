// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { fetchLlmModelMetadata } from '../../../client/settings/llm-model-metadata-fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const metadataPayload = {
  providerId: 'openai',
  modelId: 'gpt-4o',
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  source: 'models-dev',
  via: 'inferred',
  snapshotFetchedAt: 1_700_000_000_000,
}

describe('fetchLlmModelMetadata', () => {
  afterEach(() => {
    restoreFetch()
  })

  test('GETs the lookup endpoint with the supplied params and parses the payload', async () => {
    const captured: { url: string; init: RequestInit }[] = []
    setMockFetch((url, init) => {
      captured.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify(metadataPayload), { status: 200 }))
    })

    const result = await fetchLlmModelMetadata({ providerType: 'openai', model: 'gpt-4o' })

    expect(result.source).toBe('models-dev')
    expect(result.contextWindow).toBe(128_000)
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

  test('forwards the abort signal to the underlying fetch', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    setMockFetch((_url, init) => {
      signals.push(init.signal)
      return Promise.resolve(new Response(JSON.stringify(metadataPayload), { status: 200 }))
    })
    const controller = new AbortController()

    await fetchLlmModelMetadata({ model: 'gpt-4o' }, { signal: controller.signal })

    expect(signals[0]).toBe(controller.signal)
  })
})
