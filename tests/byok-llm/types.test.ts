// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { BYOK_LLM_KEYS, REQUIRED_BYOK_LLM_KEYS, type PartialByokLlmConfig } from '../../src/byok-llm/types.js'

describe('byok-llm/types', () => {
  test('BYOK_LLM_KEYS enumerates every BYOK field in a stable order', () => {
    expect(BYOK_LLM_KEYS).toEqual(['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'])
  })

  test('REQUIRED_BYOK_LLM_KEYS is the required subset', () => {
    expect(REQUIRED_BYOK_LLM_KEYS).toEqual(['llm_apikey', 'llm_baseurl', 'main_model'])
  })

  test('every required key is also a known BYOK key', () => {
    for (const key of REQUIRED_BYOK_LLM_KEYS) {
      expect(BYOK_LLM_KEYS).toContain(key)
    }
  })

  test('PartialByokLlmConfig accepts an empty object', () => {
    const config: PartialByokLlmConfig = {}
    expect(config).toEqual({})
  })
})
