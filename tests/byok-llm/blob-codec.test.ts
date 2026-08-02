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
})
