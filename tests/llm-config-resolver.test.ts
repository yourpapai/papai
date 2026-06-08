// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { disableByokForContext, enableByokForContext, updateByokLlmConfig } from '../src/byok-llm/store.js'
import { byokLlmCredentials } from '../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { resolveEffectiveLlmConfig } from '../src/llm-config-resolver.js'
import { setSystemConfig } from '../src/system-config.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from './utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  resetSystemConfigCacheForTesting()
})

const seedGlobal = (): void => {
  setSystemConfig('llm_apikey', 'sk-global', 'env')
  setSystemConfig('llm_baseurl', 'https://global.invalid/v1', 'env')
  setSystemConfig('main_model', 'global-main', 'env')
  setSystemConfig('small_model', 'global-small', 'env')
  setSystemConfig('embedding_model', 'global-embed', 'env')
}

describe('resolveEffectiveLlmConfig', () => {
  test('returns global config when BYOK has no row or is disabled', () => {
    seedGlobal()
    disableByokForContext('ctx-disabled', 'admin-1')

    const expectedGlobal = {
      ok: true,
      source: 'global',
      llmApiKey: 'sk-global',
      llmBaseUrl: 'https://global.invalid/v1',
      mainModel: 'global-main',
      smallModel: 'global-small',
      embeddingModel: 'global-embed',
    } as const

    expect(resolveEffectiveLlmConfig('ctx-no-row')).toEqual(expectedGlobal)
    expect(resolveEffectiveLlmConfig('ctx-disabled')).toEqual(expectedGlobal)
  })

  test('returns complete BYOK config with optional model fallback to BYOK main', () => {
    seedGlobal()
    updateByokLlmConfig(
      'ctx-byok',
      { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok.invalid/v1', main_model: 'byok-main' },
      'user-1',
    )

    expect(resolveEffectiveLlmConfig('ctx-byok')).toEqual({
      ok: true,
      source: 'byok',
      llmApiKey: 'sk-byok',
      llmBaseUrl: 'https://byok.invalid/v1',
      mainModel: 'byok-main',
      smallModel: 'byok-main',
      embeddingModel: 'byok-main',
    })
  })

  test('returns BYOK missing result without global fallback', () => {
    seedGlobal()
    enableByokForContext('ctx-missing', 'admin-1')

    expect(resolveEffectiveLlmConfig('ctx-missing')).toEqual({
      ok: false,
      type: 'missing',
      source: 'byok',
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
    })
  })

  test('returns BYOK error result for unreadable encrypted payload', () => {
    seedGlobal()
    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({
        contextId: 'ctx-bad',
        enabled: true,
        encryptedConfig: 'not-base64',
        updatedAt: 1,
        updatedBy: 'admin',
      })
      .run()

    expect(resolveEffectiveLlmConfig('ctx-bad')).toEqual({
      ok: false,
      type: 'error',
      source: 'byok',
      error: 'stored BYOK LLM credentials are unreadable',
    })
  })

  test('returns global missing result when required global keys are missing', () => {
    setSystemConfig('small_model', 'global-small', 'env')
    setSystemConfig('embedding_model', 'global-embed', 'env')

    expect(resolveEffectiveLlmConfig('ctx-no-row')).toEqual({
      ok: false,
      type: 'missing',
      source: 'global',
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
    })
  })
})
