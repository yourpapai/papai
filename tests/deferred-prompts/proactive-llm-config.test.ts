// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getLlmConfig } from '../../src/deferred-prompts/proactive-llm-config.js'
import type { LlmConfigResult } from '../../src/llm-providers/types.js'
import { mockLogger } from '../utils/test-helpers.js'

mockLogger()

const noneMetadata = {
  providerId: null,
  modelId: null,
  contextWindow: null,
  maxOutputTokens: null,
  source: 'none' as const,
  via: null,
}

const okResult: LlmConfigResult = {
  ok: true,
  source: 'global',
  main: {
    apiKey: 'sk-main',
    baseUrl: 'https://main.invalid/v1',
    model: 'main-model',
    source: 'global',
    metadata: noneMetadata,
  },
  small: {
    apiKey: 'sk-small',
    baseUrl: 'https://small.invalid/v1',
    model: 'small-model',
    source: 'global',
    metadata: noneMetadata,
  },
  embedding: {
    apiKey: 'sk-embed',
    baseUrl: 'https://embed.invalid/v1',
    model: 'embed-model',
    source: 'global',
    metadata: noneMetadata,
  },
}

describe('getLlmConfig', () => {
  test('returns apiKey/baseURL/model fields from the resolved main role when config resolves', () => {
    const result = getLlmConfig('ctx-1', { resolveLlmConfig: () => okResult })
    expect(result).toEqual({
      apiKey: 'sk-main',
      baseURL: 'https://main.invalid/v1',
      mainModel: 'main-model',
    })
  })

  test('returns the not-fully-configured message when the global admin config is missing', () => {
    const result = getLlmConfig('ctx-1', {
      resolveLlmConfig: () => ({ ok: false, type: 'missing', source: 'global', missing: ['main'] }),
    })
    expect(result).toBe(
      'I could not deliver a scheduled reminder or alert — the bot is not fully configured. The administrator has been notified.',
    )
  })

  test('returns the BYOK-missing-settings message when BYOK is enabled but incomplete', () => {
    const result = getLlmConfig('ctx-1', {
      resolveLlmConfig: () => ({ ok: false, type: 'missing', source: 'byok', missing: ['main'] }),
    })
    expect(result).toBe(
      'I could not deliver a scheduled reminder or alert — BYOK is enabled for this context, but the required LLM settings are missing. Use /config to complete setup.',
    )
  })

  test('returns the BYOK-unreadable message when stored BYOK credentials cannot be decrypted', () => {
    const result = getLlmConfig('ctx-1', {
      resolveLlmConfig: () => ({ ok: false, type: 'error', source: 'byok', error: 'boom' }),
    })
    expect(result).toBe(
      'I could not deliver a scheduled reminder or alert — the BYOK credentials for this context are unreadable. Use /config to re-enter the BYOK LLM credentials in the settings web UI.',
    )
  })
})
