// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { LLM_PROVIDER_TYPES, PROVIDER_TYPE_BASE_URLS, type LlmConfigResult } from '../../src/llm-providers/types.js'

describe('llm-providers types', () => {
  test('LLM_PROVIDER_TYPES includes all expected providers', () => {
    expect(LLM_PROVIDER_TYPES).toContain('custom')
    expect(LLM_PROVIDER_TYPES).toContain('openai')
    expect(LLM_PROVIDER_TYPES).toHaveLength(7)
  })

  test('PROVIDER_TYPE_BASE_URLS maps known providers and leaves custom undefined', () => {
    expect(PROVIDER_TYPE_BASE_URLS.openai).toBe('https://api.openai.com/v1')
    expect(PROVIDER_TYPE_BASE_URLS.groq).toBe('https://api.groq.com/openai/v1')
    expect(PROVIDER_TYPE_BASE_URLS.custom).toBeUndefined()
  })

  test('LlmConfigResult union accepts the effective (ok) variant', () => {
    const resolved = {
      apiKey: 'k',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-4o-mini',
      source: 'global' as const,
    }
    const config: LlmConfigResult = {
      ok: true,
      source: 'global',
      main: { ...resolved, model: 'gpt-4o' },
      small: resolved,
      embedding: resolved,
    }
    expect(config.ok).toBe(true)
  })
})
