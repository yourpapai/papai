// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { byokLlmCredentials } from '../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { resolveEffectiveLlmConfig } from '../src/llm-config-resolver.js'
import { clearLlmAdminCacheForTesting, createLlmProvider, setAdminRoleBindings } from '../src/llm-providers/store.js'
import { setSystemConfig } from '../src/system-config.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from './utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  resetSystemConfigCacheForTesting()
  clearLlmAdminCacheForTesting()
})

/** Seed a baseline admin registry so the adapter delegates to the new per-role resolver. */
const seedAdmin = (): void => {
  const main = createLlmProvider(
    { label: 'admin-openai', providerType: 'openai', baseUrl: 'https://admin/v1', apiKey: 'sk-admin' },
    'admin',
  )
  const small = createLlmProvider(
    { label: 'admin-small', providerType: 'custom', baseUrl: 'https://admin-small/v1', apiKey: 'sk-admin-small' },
    'admin',
  )
  setAdminRoleBindings(
    {
      main: { providerId: main.id, model: 'gpt-main' },
      small: { providerId: small.id, model: 'gpt-small' },
      embedding: { providerId: main.id, model: 'text-embed' },
    },
    'admin',
  )
}

const seedGlobal = (): void => {
  setSystemConfig('llm_apikey', 'sk-global', 'env')
  setSystemConfig('llm_baseurl', 'https://global.invalid/v1', 'env')
  setSystemConfig('main_model', 'global-main', 'env')
  setSystemConfig('small_model', 'global-small', 'env')
  setSystemConfig('embedding_model', 'global-embed', 'env')
}

describe('resolveEffectiveLlmConfig — adapter over per-role resolver', () => {
  test('maps new per-role result back to the legacy single-cred shape (source from main)', () => {
    seedAdmin()
    const r = resolveEffectiveLlmConfig('ctx-no-byok')
    expect(r).toEqual({
      ok: true,
      source: 'global',
      llmApiKey: 'sk-admin',
      llmBaseUrl: 'https://admin/v1',
      mainModel: 'gpt-main',
      smallModel: 'gpt-small',
      embeddingModel: 'text-embed',
    })
  })

  test('reports missing when there is no admin binding AND no legacy system_config', () => {
    expect(resolveEffectiveLlmConfig('ctx-no-row')).toEqual({
      ok: false,
      type: 'missing',
      source: 'global',
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
    })
  })

  test('propagates an unreadable BYOK blob as an error (only hard BYOK failure)', () => {
    seedAdmin()
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

  test('legacy fallback: with NO admin binding but WITH system_config keys, returns the legacy global shape', () => {
    seedGlobal()
    // No admin binding seeded — proves the fresh-deploy bridge still works.
    expect(resolveEffectiveLlmConfig('ctx-fresh-deploy')).toEqual({
      ok: true,
      source: 'global',
      llmApiKey: 'sk-global',
      llmBaseUrl: 'https://global.invalid/v1',
      mainModel: 'global-main',
      smallModel: 'global-small',
      embeddingModel: 'global-embed',
    })
  })

  test('legacy fallback reports the missing global keys when system_config is incomplete', () => {
    setSystemConfig('small_model', 'global-small', 'env')
    expect(resolveEffectiveLlmConfig('ctx-no-row')).toEqual({
      ok: false,
      type: 'missing',
      source: 'global',
      missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
    })
  })
})
