// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  AdminPluginConfigError,
  applyAdminPluginConfigUpdate,
  getAdminPluginConfigSnapshot,
  type AdminPluginConfigErrorKind,
  type PluginConfigDescriptor,
} from '../../src/debug/admin-plugin-config.js'
import { getPluginAdminConfig, setPluginAdminConfig } from '../../src/plugins/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const captureError = (fn: () => void): AdminPluginConfigError | null => {
  try {
    fn()
  } catch (err) {
    return err instanceof AdminPluginConfigError ? err : null
  }
  return null
}

const expectErrorKind = (fn: () => void, kind: AdminPluginConfigErrorKind): void => {
  const err = captureError(fn)
  expect(err).not.toBeNull()
  expect(err?.kind).toBe(kind)
}

const SAMPLE_DESCRIPTORS: PluginConfigDescriptor[] = [
  {
    pluginId: 'hello-world',
    configRequirements: [
      { key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' },
      { key: 'endpoint', label: 'Endpoint URL', required: false, sensitive: false, scope: 'admin' },
      { key: 'user_token', label: 'User Token', required: true, sensitive: true, scope: 'context' },
    ],
  },
  {
    pluginId: 'no-admin-keys',
    configRequirements: [{ key: 'ctx_key', label: 'Context Key', required: false, sensitive: false, scope: 'context' }],
  },
]

describe('getAdminPluginConfigSnapshot', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty plugins array when no plugins have admin config', () => {
    const snap = getAdminPluginConfigSnapshot([])
    expect(snap.plugins).toEqual([])
  })

  test('skips plugins with no admin-scoped config requirements', () => {
    const descriptors: PluginConfigDescriptor[] = [
      {
        pluginId: 'ctx-only',
        configRequirements: [{ key: 'ctx_key', label: 'Ctx', required: false, sensitive: false, scope: 'context' }],
      },
    ]
    const snap = getAdminPluginConfigSnapshot(descriptors)
    expect(snap.plugins).toEqual([])
  })

  test('returns plugin config entries with masked sensitive values', () => {
    setPluginAdminConfig('hello-world', 'api_key', 'sk-secret1234', 'admin-1')
    setPluginAdminConfig('hello-world', 'endpoint', 'https://api.example.com', 'admin-1')

    const snap = getAdminPluginConfigSnapshot(SAMPLE_DESCRIPTORS)
    expect(snap.plugins).toHaveLength(1)
    const plugin = snap.plugins[0]!
    expect(plugin.pluginId).toBe('hello-world')
    expect(plugin.keys).toHaveLength(2)

    const apiKeyEntry = plugin.keys.find((k) => k.key === 'api_key')!
    expect(apiKeyEntry.value).toBe('****1234')
    expect(apiKeyEntry.sensitive).toBe(true)
    expect(apiKeyEntry.required).toBe(true)

    const endpointEntry = plugin.keys.find((k) => k.key === 'endpoint')!
    expect(endpointEntry.value).toBe('https://api.example.com')
    expect(endpointEntry.sensitive).toBe(false)
  })

  test('returns null for unset config keys', () => {
    const snap = getAdminPluginConfigSnapshot(SAMPLE_DESCRIPTORS)
    expect(snap.plugins).toHaveLength(1)
    const plugin = snap.plugins[0]!
    for (const key of plugin.keys) {
      expect(key.value).toBeNull()
    }
  })

  test('skips context-scoped config requirements', () => {
    setPluginAdminConfig('hello-world', 'user_token', 'tok-abc', 'admin-1')
    const snap = getAdminPluginConfigSnapshot(SAMPLE_DESCRIPTORS)
    const plugin = snap.plugins[0]!
    expect(plugin.keys.find((k) => k.key === 'user_token')).toBeUndefined()
  })
})

describe('applyAdminPluginConfigUpdate', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('stores a valid config update', () => {
    const before = Date.now()
    const result = applyAdminPluginConfigUpdate(
      { pluginId: 'hello-world', key: 'api_key', value: 'sk-new5678' },
      'admin-1',
      SAMPLE_DESCRIPTORS,
    )
    const after = Date.now()

    expect(result.pluginId).toBe('hello-world')
    expect(result.key).toBe('api_key')
    expect(result.updatedAt).toBeGreaterThanOrEqual(before)
    expect(result.updatedAt).toBeLessThanOrEqual(after)
    expect(getPluginAdminConfig('hello-world', 'api_key')).toBe('sk-new5678')
  })

  test('trims whitespace from the value', () => {
    applyAdminPluginConfigUpdate(
      { pluginId: 'hello-world', key: 'endpoint', value: '  https://trimmed.com  ' },
      'admin-1',
      SAMPLE_DESCRIPTORS,
    )
    expect(getPluginAdminConfig('hello-world', 'endpoint')).toBe('https://trimmed.com')
  })

  test('rejects unknown plugin ids', () => {
    expectErrorKind(() => {
      applyAdminPluginConfigUpdate(
        { pluginId: 'nonexistent', key: 'api_key', value: 'x' },
        'admin-1',
        SAMPLE_DESCRIPTORS,
      )
    }, 'bad-plugin')
  })

  test('rejects undeclared config keys', () => {
    expectErrorKind(() => {
      applyAdminPluginConfigUpdate(
        { pluginId: 'hello-world', key: 'undeclared_key', value: 'x' },
        'admin-1',
        SAMPLE_DESCRIPTORS,
      )
    }, 'bad-key')
  })

  test('rejects context-scoped keys', () => {
    expectErrorKind(() => {
      applyAdminPluginConfigUpdate(
        { pluginId: 'hello-world', key: 'user_token', value: 'tok' },
        'admin-1',
        SAMPLE_DESCRIPTORS,
      )
    }, 'bad-key')
  })

  test('rejects empty value', () => {
    expectErrorKind(() => {
      applyAdminPluginConfigUpdate(
        { pluginId: 'hello-world', key: 'api_key', value: '' },
        'admin-1',
        SAMPLE_DESCRIPTORS,
      )
    }, 'bad-value')
  })

  test('rejects whitespace-only value', () => {
    expectErrorKind(() => {
      applyAdminPluginConfigUpdate(
        { pluginId: 'hello-world', key: 'api_key', value: '   ' },
        'admin-1',
        SAMPLE_DESCRIPTORS,
      )
    }, 'bad-value')
  })

  test('rejects non-object body', () => {
    expectErrorKind(() => {
      applyAdminPluginConfigUpdate('not-an-object', 'admin-1', SAMPLE_DESCRIPTORS)
    }, 'bad-value')
  })
})
