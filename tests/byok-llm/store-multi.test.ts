// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  deleteByokProvider,
  disableByokForContext,
  enableByokForContext,
  getByokBundle,
  getByokLlmConfig,
  setByokRoles,
  updateByokLlmConfig,
  updateByokProviderVerification,
  upsertByokProvider,
} from '../../src/byok-llm/store.js'
import { byokLlmCredentials } from '../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import type { LlmProviderAccount, LlmRoleBindings, Verification } from '../../src/llm-providers/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const originalKey = process.env['INSTANCE_CONFIG_KEY']
const unreadableByokConfigError = 'stored BYOK LLM credentials are unreadable'

const unverified = (): Verification => ({
  status: 'unverified',
  error: null,
  at: null,
  models: [],
  modelsFetchedAt: null,
})

const makeProvider = (overrides: Partial<LlmProviderAccount> = {}): LlmProviderAccount => ({
  id: 'prov-1',
  label: 'Test provider',
  providerType: 'custom',
  baseUrl: 'https://byok.invalid/v1',
  apiKey: 'sk-test',
  verification: unverified(),
  ...overrides,
})

const insertCorruptedByokRow = (contextId: string): void => {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({
      contextId,
      enabled: true,
      encryptedConfig: 'not-base64',
      updatedAt: Date.now(),
      updatedBy: 'seed-user',
    })
    .run()
}

beforeEach(async () => {
  mockLogger()
  process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
  await setupTestDb()
})

afterEach(() => {
  if (originalKey === undefined) delete process.env['INSTANCE_CONFIG_KEY']
  else process.env['INSTANCE_CONFIG_KEY'] = originalKey
})

describe('byok-llm multi-provider store ops', () => {
  test('getByokBundle returns disabled empty bundle for a context with no row', () => {
    expect(getByokBundle('ctx-none')).toEqual({ enabled: false, blob: null, unreadable: false, error: null })
  })

  test('getByokBundle returns disabled bundle for a disabled row', () => {
    enableByokForContext('ctx-disabled', 'admin-1')
    disableByokForContext('ctx-disabled', 'admin-2')

    expect(getByokBundle('ctx-disabled')).toEqual({ enabled: false, blob: null, unreadable: false, error: null })
  })

  test('getByokBundle lifts an enabled legacy flat blob into a single-provider v2 blob', () => {
    enableByokForContext('ctx-legacy', 'admin-1')
    updateByokLlmConfig(
      'ctx-legacy',
      {
        llm_apikey: 'sk-legacy',
        llm_baseurl: 'https://legacy.invalid/v1',
        main_model: 'legacy-main',
        small_model: 'legacy-small',
      },
      'user-1',
    )

    const bundle = getByokBundle('ctx-legacy')
    expect(bundle.enabled).toBe(true)
    expect(bundle.unreadable).toBe(false)
    expect(bundle.error).toBeNull()
    expect(bundle.blob?.v).toBe(2)
    expect(bundle.blob?.providers).toHaveLength(1)
    expect(bundle.blob?.providers[0]?.apiKey).toBe('sk-legacy')
    expect(bundle.blob?.roles.main.model).toBe('legacy-main')
    expect(bundle.blob?.roles.small?.model).toBe('legacy-small')
  })

  test('getByokBundle reports unreadable for garbage encrypted config', () => {
    insertCorruptedByokRow('ctx-bad')

    expect(getByokBundle('ctx-bad')).toEqual({
      enabled: true,
      blob: null,
      unreadable: true,
      error: unreadableByokConfigError,
    })
  })

  test('upsertByokProvider stores a provider readable through getByokBundle', () => {
    enableByokForContext('ctx-prov', 'admin-1')
    const provider = makeProvider()

    upsertByokProvider('ctx-prov', provider, 'user-1')

    const bundle = getByokBundle('ctx-prov')
    expect(bundle.enabled).toBe(true)
    expect(bundle.blob?.providers).toHaveLength(1)
    expect(bundle.blob?.providers[0]).toEqual(provider)
  })

  test('upsertByokProvider replaces an existing provider with the same id', () => {
    enableByokForContext('ctx-prov', 'admin-1')
    upsertByokProvider('ctx-prov', makeProvider({ label: 'first' }), 'user-1')
    upsertByokProvider('ctx-prov', makeProvider({ label: 'second' }), 'user-2')

    const bundle = getByokBundle('ctx-prov')
    expect(bundle.blob?.providers).toHaveLength(1)
    expect(bundle.blob?.providers[0]?.label).toBe('second')
  })

  test('setByokRoles persists role bindings', () => {
    enableByokForContext('ctx-roles', 'admin-1')
    upsertByokProvider('ctx-roles', makeProvider({ id: 'prov-main' }), 'user-1')
    upsertByokProvider('ctx-roles', makeProvider({ id: 'prov-small' }), 'user-1')
    const roles: LlmRoleBindings = {
      main: { providerId: 'prov-main', model: 'gpt-main' },
      small: { providerId: 'prov-small', model: 'gpt-small' },
      embedding: null,
    }

    setByokRoles('ctx-roles', roles, 'user-1')

    expect(getByokBundle('ctx-roles').blob?.roles).toEqual(roles)
  })

  test('deleteByokProvider removes the provider and clears its role bindings', () => {
    enableByokForContext('ctx-del', 'admin-1')
    upsertByokProvider('ctx-del', makeProvider({ id: 'prov-x' }), 'user-1')
    const roles: LlmRoleBindings = {
      main: { providerId: 'prov-x', model: 'm' },
      small: { providerId: 'prov-x', model: 's' },
      embedding: { providerId: 'prov-x', model: 'e' },
    }
    setByokRoles('ctx-del', roles, 'user-1')

    deleteByokProvider('ctx-del', 'prov-x', 'user-2')

    const bundle = getByokBundle('ctx-del')
    expect(bundle.blob?.providers).toHaveLength(0)
    expect(bundle.blob?.roles).toEqual({
      main: { providerId: '', model: '' },
      small: null,
      embedding: null,
    })
  })

  test('deleteByokProvider leaves sibling providers and their bindings untouched', () => {
    enableByokForContext('ctx-del', 'admin-1')
    upsertByokProvider('ctx-del', makeProvider({ id: 'prov-keep', label: 'keep' }), 'user-1')
    upsertByokProvider('ctx-del', makeProvider({ id: 'prov-x', label: 'x' }), 'user-1')
    setByokRoles(
      'ctx-del',
      {
        main: { providerId: 'prov-keep', model: 'm' },
        small: { providerId: 'prov-x', model: 's' },
        embedding: null,
      },
      'user-1',
    )

    deleteByokProvider('ctx-del', 'prov-x', 'user-2')

    const bundle = getByokBundle('ctx-del')
    expect(bundle.blob?.providers).toHaveLength(1)
    expect(bundle.blob?.providers[0]?.id).toBe('prov-keep')
    expect(bundle.blob?.roles.main).toEqual({ providerId: 'prov-keep', model: 'm' })
    expect(bundle.blob?.roles.small).toBeNull()
  })

  test('updateByokProviderVerification updates only the matched provider verification', () => {
    enableByokForContext('ctx-verify', 'admin-1')
    upsertByokProvider('ctx-verify', makeProvider({ id: 'prov-v' }), 'user-1')
    const verified: Verification = {
      status: 'verified',
      error: null,
      at: 123,
      models: ['gpt-4o', 'gpt-4o-mini'],
      modelsFetchedAt: 456,
    }

    updateByokProviderVerification('ctx-verify', 'prov-v', verified, 'user-2')

    expect(getByokBundle('ctx-verify').blob?.providers[0]?.verification).toEqual(verified)
  })

  test('multi-provider blob writes stay readable by the legacy getByokLlmConfig path', () => {
    enableByokForContext('ctx-coexist', 'admin-1')
    upsertByokProvider('ctx-coexist', makeProvider(), 'user-1')

    expect(getByokLlmConfig('ctx-coexist')).toEqual({})
  })
})
