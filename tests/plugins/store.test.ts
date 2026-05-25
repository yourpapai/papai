// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  getAllPluginAdminStates,
  getEnabledPluginsForContext,
  getPluginAdminState,
  getPluginContextState,
  getRecentRuntimeEvents,
  isPluginEnabledForContext,
  kvDelete,
  kvGet,
  kvList,
  kvSet,
  recordRuntimeEvent,
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

  describe('getAllPluginAdminStates', () => {
    test('returns all records', () => {
      upsertPluginAdminState('plugin-a', 'discovered')
      upsertPluginAdminState('plugin-b', 'approved')
      const rows = getAllPluginAdminStates()
      expect(rows.length).toBeGreaterThanOrEqual(2)
      const ids = rows.map((r) => r.pluginId)
      expect(ids).toContain('plugin-a')
      expect(ids).toContain('plugin-b')
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

    test('getEnabledPluginsForContext returns only enabled plugins', () => {
      setPluginContextEnabled('plugin-a', 'ctx-1', true)
      setPluginContextEnabled('plugin-b', 'ctx-1', false)
      setPluginContextEnabled('plugin-c', 'ctx-1', true)
      const enabled = getEnabledPluginsForContext('ctx-1')
      expect(enabled).toContain('plugin-a')
      expect(enabled).toContain('plugin-c')
      expect(enabled).not.toContain('plugin-b')
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

  describe('runtime events', () => {
    test('records an activation event', () => {
      recordRuntimeEvent('plug', 'activated', 'ok')
      const events = getRecentRuntimeEvents('plug')
      expect(events.length).toBe(1)
      expect(events[0]?.eventType).toBe('activated')
      expect(events[0]?.message).toBe('ok')
    })

    test('records an error event', () => {
      recordRuntimeEvent('plug', 'error', 'something broke')
      const events = getRecentRuntimeEvents('plug')
      const err = events.find((e) => e.eventType === 'error')
      expect(err?.message).toBe('something broke')
    })

    test('returns empty array for unknown plugin', () => {
      expect(getRecentRuntimeEvents('unknown-plugin')).toEqual([])
    })

    test('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) recordRuntimeEvent('plug', 'activated')
      const events = getRecentRuntimeEvents('plug', 3)
      expect(events.length).toBe(3)
    })
  })
})
