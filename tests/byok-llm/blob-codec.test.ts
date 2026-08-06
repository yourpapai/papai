// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/byok-llm/blob-codec.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { decodeByokBlob, encodeByokBlob } from '../../src/byok-llm/blob-codec.js'

describe('byok blob codec', () => {
  const legacyFull = {
    llm_apikey: 'sk-x',
    llm_baseurl: 'https://x/v1',
    main_model: 'main-m',
    small_model: 'small-m',
    embedding_model: 'emb-m',
  }

  test('round-trips a v2 blob', () => {
    const blob = {
      v: 2 as const,
      providers: [
        {
          id: 'prov_x',
          label: 'm',
          providerType: 'ollama' as const,
          baseUrl: 'http://x/v1',
          apiKey: 'k',
          verification: { status: 'unverified' as const, error: null, at: null, models: [], modelsFetchedAt: null },
        },
      ],
      roles: { main: { providerId: 'prov_x', model: 'llama3' }, small: null, embedding: null },
    }
    expect(decodeByokBlob(encodeByokBlob(blob))).toEqual(blob)
  })

  test('decodes a legacy flat blob as one provider bound to all roles', () => {
    const legacy = { llm_apikey: 'sk-x', llm_baseurl: 'https://x/v1', main_model: 'm', small_model: 's' }
    const decoded = decodeByokBlob(legacy)
    expect(decoded.v).toBe(2)
    expect(decoded.providers).toHaveLength(1)
    expect(decoded.providers[0]?.apiKey).toBe('sk-x')
    expect(decoded.roles.main.model).toBe('m')
    expect(decoded.roles.small?.model).toBe('s')
    expect(decoded.roles.embedding).toBeNull()
  })

  test('legacy blob without optional models leaves small/embedding null', () => {
    const decoded = decodeByokBlob({ llm_apikey: 'k', llm_baseurl: 'u', main_model: 'm' })
    expect(decoded.roles.small).toBeNull()
    expect(decoded.roles.embedding).toBeNull()
  })

  test('a non-object input falls through to the default blob (isV2/isLegacy type guards)', () => {
    expect(decodeByokBlob(42)).toEqual({
      v: 2,
      providers: [],
      roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
    })
  })

  test('a non-v2, non-legacy object decodes to the exact default blob', () => {
    expect(decodeByokBlob({ foo: 'bar' })).toEqual({
      v: 2,
      providers: [],
      roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
    })
  })

  test('isV2 rejects an object whose v is not 2', () => {
    expect(decodeByokBlob({ v: 1 }).v).toBe(2)
  })

  test('a legacy blob migrates emptyVerification verbatim', () => {
    expect(decodeByokBlob(legacyFull).providers[0]?.verification).toEqual({
      status: 'unverified',
      error: null,
      at: null,
      models: [],
      modelsFetchedAt: null,
    })
  })

  test('a legacy blob migrates the provider id, label, and providerType literals', () => {
    const provider = decodeByokBlob(legacyFull).providers[0]
    expect(provider?.id).toBe('prov_legacy')
    expect(provider?.label).toBe('Migrated BYOK provider')
    expect(provider?.providerType).toBe('custom')
  })

  test('a legacy blob maps llm_baseurl to baseUrl and falls back to empty when absent', () => {
    expect(decodeByokBlob(legacyFull).providers[0]?.baseUrl).toBe('https://x/v1')
    expect(decodeByokBlob({ llm_apikey: 'k' }).providers[0]?.baseUrl).toBe('')
  })

  test('a legacy blob falls back to an empty apiKey when the value is nullish', () => {
    expect(decodeByokBlob({ llm_apikey: null }).providers[0]?.apiKey).toBe('')
  })

  test('a legacy blob binds embedding_model onto the embedding role', () => {
    expect(decodeByokBlob(legacyFull).roles.embedding).toEqual({
      providerId: 'prov_legacy',
      model: 'emb-m',
    })
  })

  test('a legacy blob without main_model falls back to an empty main model', () => {
    expect(decodeByokBlob({ llm_apikey: 'k' }).roles.main).toEqual({
      providerId: 'prov_legacy',
      model: '',
    })
  })
})
