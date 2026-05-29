// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config-editor public API
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  createEditorSession,
  deleteEditorSession,
  getEditorSession,
  handleEditorCallback,
  handleEditorMessage,
  hasActiveEditor,
  parseCallbackData,
  resolveCallbackKey,
  serializeCallbackData,
  startEditor,
} from '../../src/config-editor/index.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

describe('config-editor public API', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType('very-long-plugin-provider-name')
  })

  const userId = 'user123'
  const storageContextId = 'ctx456'

  test('exports startEditor function', () => {
    const result = startEditor(userId, storageContextId, 'kaneo_apikey')
    expect(result.handled).toBe(true)
  })

  test('exports state management functions', () => {
    expect(typeof createEditorSession).toBe('function')
    expect(typeof getEditorSession).toBe('function')
    expect(typeof hasActiveEditor).toBe('function')
    expect(typeof deleteEditorSession).toBe('function')
  })

  test('exports handler functions', () => {
    expect(typeof handleEditorCallback).toBe('function')
    expect(typeof handleEditorMessage).toBe('function')
    expect(typeof parseCallbackData).toBe('function')
    expect(typeof serializeCallbackData).toBe('function')
  })

  test('parseCallbackData works correctly', () => {
    expect(parseCallbackData('cfg:cancel')).toEqual({ action: 'cancel', key: null })
    expect(parseCallbackData('cfg:back')).toEqual({ action: 'back', key: null })
    expect(parseCallbackData('cfg:setup')).toEqual({ action: 'setup', key: null })
    expect(parseCallbackData('cfg:edit:kaneo_apikey')).toEqual({
      action: 'edit',
      key: 'kaneo_apikey',
    })
    expect(parseCallbackData('cfg:save:timezone')).toEqual({ action: 'save', key: 'timezone' })
    expect(parseCallbackData('invalid')).toEqual({ action: null, key: null })
  })

  test('serializeCallbackData works correctly', () => {
    expect(serializeCallbackData({ action: 'cancel' })).toBe('cfg:cancel')
    expect(serializeCallbackData({ action: 'back' })).toBe('cfg:back')
    expect(serializeCallbackData({ action: 'setup' })).toBe('cfg:setup')
    expect(serializeCallbackData({ action: 'edit', key: 'kaneo_apikey' })).toBe('cfg:edit:kaneo_apikey')
    expect(serializeCallbackData({ action: 'save', key: 'timezone' })).toBe('cfg:save:timezone')
  })

  test('save callbacks round-trip a session token when provided', () => {
    const data = serializeCallbackData({ action: 'save', key: 'timezone', sessionToken: 'abc123' }, 'group-9')

    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64)

    const parsed = parseCallbackData(data)
    expect(parsed.action).toBe('save')
    expect(parsed.key).toBe('timezone')
    expect(parsed.sessionToken).toBe('abc123')
    expect(parsed.targetContextId).toBe('group-9')
  })

  test('serializeCallbackData encodes targetContextId when provided', () => {
    const data = serializeCallbackData({ action: 'edit', key: 'timezone' }, 'group-9')
    expect(data).toContain('cfg:edit:timezone@')
    expect(data).not.toBe('cfg:edit:timezone')

    const parsed = parseCallbackData(data)
    expect(parsed.action).toBe('edit')
    expect(parsed.key).toBe('timezone')
    expect(parsed.targetContextId).toBe('group-9')
  })

  test('serializeCallbackData uses compact callback ids for long dynamic keys', () => {
    registerContributedTaskProviderType('very-long-plugin-provider-name', {
      pluginId: 'very-long-plugin-provider-name',
      factory: () => createMockProvider({ name: 'very-long-plugin-provider-name' }),
      capabilities: new Set(),
      displayName: 'Long Plugin Provider',
      configSchema: [
        {
          key: 'very-long-context-token-field',
          label: 'Plugin Token',
          required: true,
          sensitive: true,
          scope: 'context',
        },
      ],
    })
    insertTaskInstance({
      id: 'long-plugin-prod',
      type: 'very-long-plugin-provider-name',
      config: { baseUrl: 'https://plugin.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'managed-group-context-with-long-id',
      taskInstanceId: 'long-plugin-prod',
      platformInstanceId: 'telegram-default',
    })
    const key = 'plugin:very-long-plugin-provider-name:provider:very-long-context-token-field'
    const data = serializeCallbackData({ action: 'edit', key }, 'managed-group-context-with-long-id')

    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64)
    expect(data).not.toContain(key)
    const parsed = parseCallbackData(data)
    expect(parsed.action).toBe('edit')
    expect(resolveCallbackKey(parsed.key, 'managed-group-context-with-long-id')).toBe(key)
  })

  test('resolveCallbackKey fails closed when compact callback field ordering changes', () => {
    registerContributedTaskProviderType('very-long-plugin-provider-name', {
      pluginId: 'very-long-plugin-provider-name',
      factory: () => createMockProvider({ name: 'very-long-plugin-provider-name' }),
      capabilities: new Set(),
      displayName: 'Long Plugin Provider',
      configSchema: [
        {
          key: 'very-long-context-token-field',
          label: 'Plugin Token',
          required: true,
          sensitive: true,
          scope: 'context',
        },
      ],
    })
    insertTaskInstance({
      id: 'long-plugin-prod-remap',
      type: 'very-long-plugin-provider-name',
      config: { baseUrl: 'https://plugin.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'managed-group-context-remap',
      taskInstanceId: 'long-plugin-prod-remap',
      platformInstanceId: 'telegram-default',
    })

    const key = 'plugin:very-long-plugin-provider-name:provider:very-long-context-token-field'
    const data = serializeCallbackData({ action: 'edit', key }, 'managed-group-context-remap')
    const parsed = parseCallbackData(data)

    unregisterContributedTaskProviderType('very-long-plugin-provider-name')

    expect(resolveCallbackKey(parsed.key, 'managed-group-context-remap')).toBeNull()
  })

  test('serializeCallbackData keeps all actions within callback size limit for long contexts', () => {
    const targetContextId = 'managed-group-context-with-a-very-long-stable-storage-id'
    const key = 'plugin:very-long-plugin-provider-name:provider:very-long-context-token-field'
    const actions = [
      { action: 'edit' as const, key },
      { action: 'save' as const, key, sessionToken: 'abc123' },
      { action: 'cancel' as const },
      { action: 'back' as const },
      { action: 'setup' as const },
    ]

    const data = actions.map((button) => serializeCallbackData(button, targetContextId))

    expect(data.every((callbackData) => Buffer.byteLength(callbackData, 'utf8') <= 64)).toBe(true)
  })

  test('compact non-field callbacks keep a target binding tag', () => {
    const targetContextId = 'managed-group-context-with-a-very-long-stable-storage-id'
    const actions = ['cancel', 'back', 'setup'] as const

    for (const action of actions) {
      const data = serializeCallbackData({ action }, targetContextId)
      const parsed = parseCallbackData(data)

      expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64)
      expect(parsed.action).toBe(action)
      expect(parsed.key).toBeNull()
      expect(parsed.targetContextId).toBeUndefined()
      expect(parsed.targetTag).toBeString()
    }
  })

  test('compact callbacks parse without module-local token state', () => {
    expect(parseCallbackData('cfg:e:0:abc123:def456')).toEqual({ action: 'edit', key: '#0:abc123:def456' })
    expect(parseCallbackData('cfg:s:z:def456:ghi789')).toEqual({ action: 'save', key: '#z:def456:ghi789' })
  })

  test('resolveCallbackKey resolves compact field indexes for a context', () => {
    const data = serializeCallbackData(
      { action: 'edit', key: 'timezone' },
      'ctx456-with-long-suffix-that-forces-compact',
    )
    const parsed = parseCallbackData(data)

    expect(resolveCallbackKey(parsed.key, 'ctx456-with-long-suffix-that-forces-compact')).toBe('timezone')
  })

  test('resolveCallbackKey rejects compact field indexes for the wrong context', () => {
    const data = serializeCallbackData(
      { action: 'edit', key: 'timezone' },
      'ctx456-with-long-suffix-that-forces-compact',
    )
    const parsed = parseCallbackData(data)

    expect(resolveCallbackKey(parsed.key, 'different-context')).toBeNull()
  })

  test('parseCallbackData returns targetContextId from encoded callback', () => {
    const encoded = serializeCallbackData({ action: 'cancel' }, 'group-42')
    const parsed = parseCallbackData(encoded)
    expect(parsed.action).toBe('cancel')
    expect(parsed.targetContextId).toBe('group-42')
  })

  test('parseCallbackData returns undefined targetContextId for legacy callbacks', () => {
    expect(parseCallbackData('cfg:edit:timezone').targetContextId).toBeUndefined()
    expect(parseCallbackData('cfg:cancel').targetContextId).toBeUndefined()
  })
})
