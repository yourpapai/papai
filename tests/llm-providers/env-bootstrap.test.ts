// tests/llm-providers/env-bootstrap.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { seedDefaultLlmProviderFromEnv } from '../../src/llm-providers/env-bootstrap.js'
import { clearLlmAdminCacheForTesting, getAdminRoleBindings, listLlmProviders } from '../../src/llm-providers/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const clearEnv = (): void => {
  delete process.env['LLM_API_KEY']
  delete process.env['LLM_BASE_URL']
  delete process.env['MAIN_MODEL']
  delete process.env['SMALL_MODEL']
  delete process.env['EMBEDDING_MODEL']
}

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  clearLlmAdminCacheForTesting()
  clearEnv()
})

afterEach(() => {
  clearEnv()
  delete process.env['INSTANCE_CONFIG_KEY']
})

describe('seedDefaultLlmProviderFromEnv', () => {
  test('seeds default provider when env present and admin registry empty', () => {
    process.env['LLM_API_KEY'] = 'sk-env'
    process.env['LLM_BASE_URL'] = 'https://api.invalid/v1'
    process.env['MAIN_MODEL'] = 'gpt-env'
    seedDefaultLlmProviderFromEnv()

    expect(getAdminRoleBindings()).not.toBeNull()
  })

  test('seeds a default provider + main binding when env present and admin empty', () => {
    process.env['LLM_API_KEY'] = 'sk-env'
    process.env['LLM_BASE_URL'] = 'https://api.invalid/v1'
    process.env['MAIN_MODEL'] = 'gpt-env'
    process.env['SMALL_MODEL'] = 'gpt-small'
    process.env['EMBEDDING_MODEL'] = 'text-embed'

    seedDefaultLlmProviderFromEnv()

    const bindings = getAdminRoleBindings()
    expect(bindings).not.toBeNull()
    expect(bindings!.main.model).toBe('gpt-env')
    expect(bindings!.small?.model).toBe('gpt-small')
    expect(bindings!.embedding?.model).toBe('text-embed')

    const providers = listLlmProviders()
    expect(providers).toHaveLength(1)
    expect(providers[0]!.label).toBe('Default (env)')
    expect(providers[0]!.providerType).toBe('custom')
    expect(providers[0]!.baseUrl).toBe('https://api.invalid/v1')
    expect(providers[0]!.apiKey).toBe('sk-env')
    expect(bindings!.main.providerId).toBe(providers[0]!.id)
  })

  test('seeds without small/embedding when their env vars are absent', () => {
    process.env['LLM_API_KEY'] = 'sk-env'
    process.env['LLM_BASE_URL'] = 'https://api.invalid/v1'
    process.env['MAIN_MODEL'] = 'gpt-env'

    seedDefaultLlmProviderFromEnv()

    const bindings = getAdminRoleBindings()
    expect(bindings).not.toBeNull()
    expect(bindings!.small).toBeNull()
    expect(bindings!.embedding).toBeNull()
  })

  test('no-op when required env vars are missing', () => {
    process.env['LLM_API_KEY'] = 'sk-env'
    process.env['LLM_BASE_URL'] = 'https://api.invalid/v1'

    seedDefaultLlmProviderFromEnv()

    expect(getAdminRoleBindings()).toBeNull()
    expect(listLlmProviders()).toEqual([])
  })

  test('no-op when required env vars are empty', () => {
    process.env['LLM_API_KEY'] = ''
    process.env['LLM_BASE_URL'] = 'https://api.invalid/v1'
    process.env['MAIN_MODEL'] = 'gpt-env'

    seedDefaultLlmProviderFromEnv()

    expect(getAdminRoleBindings()).toBeNull()
  })

  test('no-op when admin already configured even if env present', () => {
    process.env['LLM_API_KEY'] = 'sk-env'
    process.env['LLM_BASE_URL'] = 'https://api.invalid/v1'
    process.env['MAIN_MODEL'] = 'gpt-env'

    seedDefaultLlmProviderFromEnv()
    const firstBinding = getAdminRoleBindings()
    expect(firstBinding).not.toBeNull()

    process.env['MAIN_MODEL'] = 'different-model'
    seedDefaultLlmProviderFromEnv()

    expect(getAdminRoleBindings()!.main.model).toBe('gpt-env')
    expect(listLlmProviders()).toHaveLength(1)
  })
})
