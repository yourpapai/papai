// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getPluginAdminConfig,
  getPluginAdminState,
  getPluginContextState,
  isPluginEnabledForContext,
  kvDelete,
  kvGet,
  kvList,
  kvSet,
  recordRuntimeEvent,
  setPluginAdminConfig,
  setPluginContextEnabled,
  updatePluginAdminStateField,
  upsertPluginAdminState,
} from '../../src/plugins/store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('plugin store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('upsertPluginAdminState / getPluginAdminState', () => {
    test('inserts a new record and retrieves it', () => {
      upsertPluginAdminState('my-plugin', 'discovered')
      const row = getPluginAdminState('my-plugin')
      expect(row).toBeDefined()
      expect(row?.state).toBe('discovered')
      expect(row?.approvedBy).toBeNull()
    })

    test('updates on conflict', () => {
      upsertPluginAdminState('my-plugin', 'discovered')
      upsertPluginAdminState('my-plugin', 'approved', {
        approvedBy: 'admin-123',
        approvedManifestHash: 'abc',
      })
      const row = getPluginAdminState('my-plugin')
      expect(row?.state).toBe('approved')
      expect(row?.approvedBy).toBe('admin-123')
    })

    test('returns undefined for unknown plugin', () => {
      expect(getPluginAdminState('nonexistent')).toBeUndefined()
    })
  })

  describe('updatePluginAdminStateField', () => {
    test('updates specific fields without overwriting others', () => {
      upsertPluginAdminState('my-plugin', 'discovered', { lastSeenManifestHash: 'hash1' })
      updatePluginAdminStateField('my-plugin', { state: 'approved', approvedBy: 'admin' })
      const row = getPluginAdminState('my-plugin')
      expect(row?.state).toBe('approved')
      expect(row?.approvedBy).toBe('admin')
    })
  })

  describe('context state', () => {
    test('returns undefined when no context state exists', () => {
      expect(getPluginContextState('plugin-a', 'ctx-1')).toBeUndefined()
    })

    test('sets and reads context enabled state', () => {
      setPluginContextEnabled('plugin-a', 'ctx-1', true)
      expect(isPluginEnabledForContext('plugin-a', 'ctx-1')).toBe(true)
    })

    test('updates context enabled state on second call', () => {
      setPluginContextEnabled('plugin-a', 'ctx-1', true)
      setPluginContextEnabled('plugin-a', 'ctx-1', false)
      expect(isPluginEnabledForContext('plugin-a', 'ctx-1')).toBe(false)
    })

    test('isPluginEnabledForContext returns false for unknown', () => {
      expect(isPluginEnabledForContext('no-plugin', 'no-ctx')).toBe(false)
    })
  })

  describe('KV store', () => {
    test('set and get a value', () => {
      kvSet('plug', 'ctx', 'mykey', 'myvalue')
      expect(kvGet('plug', 'ctx', 'mykey')).toBe('myvalue')
    })

    test('updates existing value', () => {
      kvSet('plug', 'ctx', 'k', 'v1')
      kvSet('plug', 'ctx', 'k', 'v2')
      expect(kvGet('plug', 'ctx', 'k')).toBe('v2')
    })

    test('returns undefined for missing key', () => {
      expect(kvGet('plug', 'ctx', 'missing')).toBeUndefined()
    })

    test('delete removes a key', () => {
      kvSet('plug', 'ctx', 'k', 'v')
      kvDelete('plug', 'ctx', 'k')
      expect(kvGet('plug', 'ctx', 'k')).toBeUndefined()
    })

    test('kvList returns all entries for a context', () => {
      kvSet('plug', 'ctx', 'a', '1')
      kvSet('plug', 'ctx', 'b', '2')
      const rows = kvList('plug', 'ctx')
      const keys = rows.map((r) => r.key)
      expect(keys).toContain('a')
      expect(keys).toContain('b')
    })

    test('kvList filters by prefix', () => {
      kvSet('plug', 'ctx', 'foo:1', 'a')
      kvSet('plug', 'ctx', 'foo:2', 'b')
      kvSet('plug', 'ctx', 'bar:1', 'c')
      const rows = kvList('plug', 'ctx', 'foo:')
      expect(rows.map((r) => r.key)).not.toContain('bar:1')
      expect(rows.length).toBe(2)
    })

    test('KV is scoped per context', () => {
      kvSet('plug', 'ctx-1', 'k', 'v1')
      kvSet('plug', 'ctx-2', 'k', 'v2')
      expect(kvGet('plug', 'ctx-1', 'k')).toBe('v1')
      expect(kvGet('plug', 'ctx-2', 'k')).toBe('v2')
    })
  })

  describe('plugin admin config', () => {
    test('returns undefined when key does not exist', () => {
      expect(getPluginAdminConfig('my-plugin', 'api_key')).toBeUndefined()
    })

    test('stores and retrieves a value', () => {
      setPluginAdminConfig('my-plugin', 'api_key', 'sk-test-123', 'admin-1')
      expect(getPluginAdminConfig('my-plugin', 'api_key')).toBe('sk-test-123')
    })

    test('overwrites an existing value', () => {
      setPluginAdminConfig('my-plugin', 'api_key', 'sk-old', 'admin-1')
      setPluginAdminConfig('my-plugin', 'api_key', 'sk-new', 'admin-1')
      expect(getPluginAdminConfig('my-plugin', 'api_key')).toBe('sk-new')
    })

    test('isolates keys by plugin id', () => {
      setPluginAdminConfig('plugin-a', 'api_key', 'key-a', 'admin-1')
      setPluginAdminConfig('plugin-b', 'api_key', 'key-b', 'admin-1')
      expect(getPluginAdminConfig('plugin-a', 'api_key')).toBe('key-a')
      expect(getPluginAdminConfig('plugin-b', 'api_key')).toBe('key-b')
    })
  })

  describe('runtime events', () => {
    test('records an activation event', () => {
      recordRuntimeEvent('plug', 'activated', 'ok')
    })

    test('records an error event', () => {
      recordRuntimeEvent('plug', 'error', 'something broke')
    })
  })
})
