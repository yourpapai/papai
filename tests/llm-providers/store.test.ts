// tests/llm-providers/store.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createLlmProvider,
  deleteLlmProvider,
  getAdminRoleBindings,
  getLlmProvider,
  listLlmProviders,
  setAdminRoleBindings,
  clearLlmAdminCacheForTesting,
} from '../../src/llm-providers/store.js'
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
  resetSystemConfigCacheForTesting()
  clearLlmAdminCacheForTesting()
})

describe('llm-providers store', () => {
  test('createLlmProvider encrypts apiKey and decrypts on read', () => {
    const created = createLlmProvider(
      { label: 'OpenAI', providerType: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' },
      'admin-1',
    )
    expect(created.apiKey).toBe('sk-test')
    expect(created.id).toMatch(/^prov_/u)

    const again = getLlmProvider(created.id)
    expect(again?.apiKey).toBe('sk-test')
  })

  test('listLlmProviders returns all accounts', () => {
    createLlmProvider({ label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'k1' }, 'admin-1')
    createLlmProvider({ label: 'b', providerType: 'custom', baseUrl: 'https://b/v1', apiKey: 'k2' }, 'admin-1')
    expect(listLlmProviders().map((p) => p.label)).toEqual(['a', 'b'])
  })

  test('deleteLlmProvider clears role bindings that referenced it', () => {
    const a = createLlmProvider(
      { label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'k1' },
      'admin-1',
    )
    const b = createLlmProvider(
      { label: 'b', providerType: 'custom', baseUrl: 'https://b/v1', apiKey: 'k2' },
      'admin-1',
    )
    setAdminRoleBindings(
      { main: { providerId: a.id, model: 'm' }, small: { providerId: b.id, model: 's' }, embedding: null },
      'admin-1',
    )

    deleteLlmProvider(b.id)

    const roles = getAdminRoleBindings()
    expect(roles?.small).toBeNull()
    expect(roles?.main.providerId).toBe(a.id)
  })

  test('deleteLlmProvider for the main provider is rejected', () => {
    const a = createLlmProvider(
      { label: 'a', providerType: 'custom', baseUrl: 'https://a/v1', apiKey: 'k1' },
      'admin-1',
    )
    setAdminRoleBindings({ main: { providerId: a.id, model: 'm' }, small: null, embedding: null }, 'admin-1')

    expect(() => deleteLlmProvider(a.id)).toThrow(/main/u)
  })

  test('getAdminRoleBindings returns null when unset', () => {
    expect(getAdminRoleBindings()).toBeNull()
  })
})
