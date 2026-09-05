// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { seedDefaultLlmProviderFromEnv } from '../../src/llm-providers/env-bootstrap.js'
import { getAdminRoleBindings, listLlmProviders, setAdminRoleBindings } from '../../src/llm-providers/store.js'
import { clearLlmAdminCacheForTesting } from '../../src/llm-providers/store.testing.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ENV_VARS = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'MAIN_MODEL',
  'SMALL_MODEL',
  'EMBEDDING_MODEL',
  'LLM_BASE_PROVIDER',
  'LLM_BASE_MODEL',
] as const

describe('seedDefaultLlmProviderFromEnv base references', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'f'.repeat(64)
    await setupTestDb()
    clearLlmAdminCacheForTesting()
    savedEnv = {}
    for (const key of ENV_VARS) {
      savedEnv[key] = process.env[key]
      Reflect.deleteProperty(process.env, key)
    }
    process.env['LLM_API_KEY'] = 'sk-env'
    process.env['LLM_BASE_URL'] = 'https://gateway.example.com/v1'
    process.env['MAIN_MODEL'] = 'main-model'
  })

  afterEach(() => {
    for (const key of ENV_VARS) {
      const saved = savedEnv[key]
      if (saved === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = saved
    }
  })

  test('seeds the provider with base references when the env variables are set', () => {
    process.env['LLM_BASE_PROVIDER'] = 'openai'
    process.env['LLM_BASE_MODEL'] = 'gpt-4o'

    seedDefaultLlmProviderFromEnv()

    const providers = listLlmProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]?.baseProvider).toBe('openai')
    expect(providers[0]?.baseModel).toBe('gpt-4o')
    expect(getAdminRoleBindings()?.main.model).toBe('main-model')
  })

  test('ignores base references when the variables are absent', () => {
    seedDefaultLlmProviderFromEnv()

    const providers = listLlmProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]?.baseProvider).toBeNull()
    expect(providers[0]?.baseModel).toBeNull()
  })

  test('ignores empty and whitespace-only base references', () => {
    process.env['LLM_BASE_PROVIDER'] = '   '
    process.env['LLM_BASE_MODEL'] = ''

    seedDefaultLlmProviderFromEnv()

    const providers = listLlmProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]?.baseProvider).toBeNull()
    expect(providers[0]?.baseModel).toBeNull()
  })

  test('base references are not applied when the seed is skipped', () => {
    setAdminRoleBindings(
      { main: { providerId: 'prov-existing', model: 'existing-model' }, small: null, embedding: null },
      'admin-1',
    )
    process.env['LLM_BASE_PROVIDER'] = 'openai'
    process.env['LLM_BASE_MODEL'] = 'gpt-4o'

    seedDefaultLlmProviderFromEnv()

    expect(listLlmProviders()).toEqual([])
    expect(getAdminRoleBindings()?.main).toEqual({ providerId: 'prov-existing', model: 'existing-model' })
  })
})
