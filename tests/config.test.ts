// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getCachedConfig, setCachedConfig } from '../src/cache.js'
import {
  getAllConfig,
  getConfig,
  getConfigValue,
  isConfigKey,
  isSensitiveKey,
  listPluginConfigValues,
  maskValue,
  setConfig,
  setConfigValue,
  setPluginConfig,
} from '../src/config.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../src/providers/registry.js'
import type { ConfigKey } from '../src/types/config.js'
import { createMockProvider } from './tools/mock-provider.js'
import { clearUserCache } from './utils/test-cache.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from './utils/test-helpers.js'

const USER_A = '111'
const USER_B = '222'

beforeEach(() => {
  mockLogger()
})

// Namespaced key used in tests that previously relied on legacy 'kaneo_apikey'
const KANEO_CREDENTIAL_KEY = 'plugin:task-provider-kaneo:provider:credential'
const YOUTRACK_TOKEN_KEY_DYNAMIC = 'plugin:task-provider-youtrack:provider:token'

describe('setConfig', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
    clearUserCache(USER_A)
    clearUserCache(USER_B)
  })

  test('stores value for user and key', () => {
    // Provider keys are now dynamic (plugin-namespaced); use setConfigValue/getConfigValue
    setConfigValue(USER_A, KANEO_CREDENTIAL_KEY, 'test-api-key')
    expect(getConfigValue(USER_A, KANEO_CREDENTIAL_KEY)).toBe('test-api-key')
  })

  test('updates existing value', () => {
    setConfigValue(USER_A, KANEO_CREDENTIAL_KEY, 'old-key')
    setConfigValue(USER_A, KANEO_CREDENTIAL_KEY, 'new-key')
    expect(getConfigValue(USER_A, KANEO_CREDENTIAL_KEY)).toBe('new-key')
  })

  test('isolates config between users', () => {
    setConfigValue(USER_A, KANEO_CREDENTIAL_KEY, 'key-a')
    setConfigValue(USER_B, KANEO_CREDENTIAL_KEY, 'key-b')
    expect(getConfigValue(USER_A, KANEO_CREDENTIAL_KEY)).toBe('key-a')
    expect(getConfigValue(USER_B, KANEO_CREDENTIAL_KEY)).toBe('key-b')
  })

  test('handles static and dynamic per-user keys', () => {
    // Static keys still use setConfig/getConfig
    setConfig(USER_A, 'timezone', 'UTC')
    expect(getConfig(USER_A, 'timezone')).toBe('UTC')
    // Dynamic provider keys use setConfigValue/getConfigValue
    setConfigValue(USER_A, KANEO_CREDENTIAL_KEY, 'value-for-kaneo')
    setConfigValue(USER_A, YOUTRACK_TOKEN_KEY_DYNAMIC, 'value-for-youtrack')
    expect(getConfigValue(USER_A, KANEO_CREDENTIAL_KEY)).toBe('value-for-kaneo')
    expect(getConfigValue(USER_A, YOUTRACK_TOKEN_KEY_DYNAMIC)).toBe('value-for-youtrack')
  })

  test('normalizes timezone shorthand before storing it', () => {
    setConfig(USER_A, 'timezone', 'UTC+5')
    expect(getCachedConfig(USER_A, 'timezone')).toBe('Etc/GMT-5')
    expect(getConfig(USER_A, 'timezone')).toBe('Etc/GMT-5')
  })
})

describe('getConfig', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
    clearUserCache(USER_A)
    clearUserCache(USER_B)
  })

  test('returns stored value', () => {
    // Provider keys are now dynamic; use setConfigValue/getConfigValue
    setConfigValue(USER_A, KANEO_CREDENTIAL_KEY, 'key-abc')
    expect(getConfigValue(USER_A, KANEO_CREDENTIAL_KEY)).toBe('key-abc')
  })

  test('returns null for unset dynamic key', () => {
    expect(getConfigValue(USER_A, KANEO_CREDENTIAL_KEY)).toBeNull()
  })

  test('normalizes legacy timezone values on read', () => {
    setCachedConfig(USER_A, 'timezone', 'UTC+5')
    expect(getConfig(USER_A, 'timezone')).toBe('Etc/GMT-5')
  })
})

describe('isConfigKey', () => {
  test('returns true for static per-user keys only', () => {
    // Only static (non-provider) keys are ConfigKey members after refactor
    const validKeys: ConfigKey[] = ['timezone', 'mcp_endpoints']
    for (const key of validKeys) {
      expect(isConfigKey(key)).toBe(true)
    }
  })

  test('returns false for legacy flat provider keys (now dynamic)', () => {
    // These were removed from ConfigKey; they are handled via isAllowedDynamicConfigKey
    expect(isConfigKey('kaneo_apikey')).toBe(false)
    expect(isConfigKey('youtrack_token')).toBe(false)
    expect(isConfigKey('kaneo_workspace_id')).toBe(false)
  })

  test('returns false for invalid keys (including former LLM keys)', () => {
    const invalidKeys = [
      'invalid',
      'linear',
      'openai',
      'token',
      '',
      'linear_key',
      'provider',
      'youtrack_url',
      'llm_apikey',
      'llm_baseurl',
      'main_model',
      'small_model',
      'embedding_model',
    ]
    for (const key of invalidKeys) {
      expect(isConfigKey(key)).toBe(false)
    }
  })
})

const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'
const YOUTRACK_TOKEN_KEY = 'plugin:task-provider-youtrack:provider:token' as const

const registerYouTrackContributed = (): void => {
  registerContributedTaskProviderType('youtrack', {
    pluginId: YOUTRACK_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'youtrack' }),
    capabilities: new Set(),
    displayName: 'YouTrack',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
    ],
    contextConfigSchema: [
      {
        key: 'token',
        label: 'YouTrack Permanent Token',
        required: true,
        sensitive: true,
        scope: 'context',
      },
    ],
    traits: new Set(),
  })
}

describe('getAllConfig', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
    clearUserCache(USER_A)
    clearUserCache(USER_B)
    registerYouTrackContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
  })

  const assignYoutrackContext = (contextId: string): void => {
    insertTaskInstance({
      id: `${contextId}-youtrack`,
      type: 'youtrack',
      config: { url: 'https://youtrack.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId, taskInstanceId: `${contextId}-youtrack`, platformInstanceId: 'telegram-default' })
  }

  test('returns only preference configs for user (youtrack contributed context)', () => {
    // youtrack is now plugin-contributed; its token key is plugin-namespaced and not a ConfigKey,
    // so getAllConfig only includes preference keys for a contributed youtrack context
    assignYoutrackContext(USER_A)
    setConfig(USER_A, 'timezone', 'UTC')
    const allConfig = getAllConfig(USER_A)
    // plugin-namespaced token key is not a ConfigKey, so it does not appear in getAllConfig
    expect(Object.keys(allConfig)).not.toContain(YOUTRACK_TOKEN_KEY)
    expect(allConfig.timezone).toBe('UTC')
  })

  test('normalizes timezone values in bulk config reads', () => {
    setCachedConfig(USER_A, 'timezone', 'UTC+5')
    const allConfig = getAllConfig(USER_A)
    expect(allConfig.timezone).toBe('Etc/GMT-5')
  })

  test('does not leak preference config from other users (youtrack contributed context)', () => {
    // youtrack is now plugin-contributed; preference isolation is still tested via timezone
    assignYoutrackContext(USER_A)
    setConfig(USER_A, 'timezone', 'America/New_York')
    setConfig(USER_B, 'timezone', 'Europe/Berlin')
    const configA = getAllConfig(USER_A)
    expect(configA.timezone).toBe('America/New_York')
    expect(configA.timezone).not.toBe('Europe/Berlin')
  })
})

const PLUGIN_TRACKER_PLUGIN_ID = 'plugin-tracker'

const registerPluginTrackerContributed = (): void => {
  registerContributedTaskProviderType('plugin-tracker', {
    pluginId: PLUGIN_TRACKER_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'plugin-tracker' }),
    capabilities: new Set(),
    displayName: 'Plugin Tracker',
    instanceConfigSchema: [],
    contextConfigSchema: [
      { key: 'credential', label: 'Plugin Credential', required: true, sensitive: true, scope: 'context' },
      { key: 'workspaceId', label: 'Workspace ID', required: false, sensitive: false, scope: 'context' },
    ],
  })
}

describe('maskValue', () => {
  beforeEach(() => {
    registerPluginTrackerContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(PLUGIN_TRACKER_PLUGIN_ID)
  })

  test('masks sensitive namespaced provider credential key', () => {
    expect(maskValue('plugin:plugin-tracker:provider:credential', 'abcd1234')).toBe('****1234')
  })

  test('returns unmasked value for non-sensitive keys', () => {
    expect(maskValue('timezone', 'America/New_York')).toBe('America/New_York')
    expect(maskValue('plugin:plugin-tracker:provider:workspaceId', 'ws-123')).toBe('ws-123')
  })

  test('handles short values for sensitive namespaced keys', () => {
    expect(maskValue('plugin:plugin-tracker:provider:credential', 'ab')).toBe('****ab')
    expect(maskValue('plugin:plugin-tracker:provider:credential', '')).toBe('****')
  })
})

describe('isSensitiveKey', () => {
  beforeEach(() => {
    registerPluginTrackerContributed()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(PLUGIN_TRACKER_PLUGIN_ID)
  })

  test('returns true for sensitive namespaced provider credential key', () => {
    expect(isSensitiveKey('plugin:plugin-tracker:provider:credential')).toBe(true)
  })

  test('returns false for non-sensitive keys', () => {
    expect(isSensitiveKey('timezone')).toBe(false)
    expect(isSensitiveKey('plugin:plugin-tracker:provider:workspaceId')).toBe(false)
  })
})

const CTX_1 = 'ctx-lpcv-1'
const CTX_2 = 'ctx-lpcv-2'
const LPCV_PLUGIN_ID = 'audio-transcribe'
const LPCV_KEY = 'default-language'

describe('listPluginConfigValues', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    clearUserCache(CTX_1)
    clearUserCache(CTX_2)
  })

  test('returns distinct values set across multiple contexts', async () => {
    setPluginConfig(CTX_1, LPCV_PLUGIN_ID, LPCV_KEY, 'en')
    setPluginConfig(CTX_2, LPCV_PLUGIN_ID, LPCV_KEY, 'fr')
    await Promise.resolve()
    const values = listPluginConfigValues(LPCV_PLUGIN_ID, LPCV_KEY)
    expect(values.sort()).toEqual(['en', 'fr'])
  })

  test('deduplicates when multiple contexts share the same value', async () => {
    setPluginConfig(CTX_1, LPCV_PLUGIN_ID, LPCV_KEY, 'en')
    setPluginConfig(CTX_2, LPCV_PLUGIN_ID, LPCV_KEY, 'en')
    await Promise.resolve()
    const values = listPluginConfigValues(LPCV_PLUGIN_ID, LPCV_KEY)
    expect(values).toEqual(['en'])
  })

  test('does not include values for a different plugin key', async () => {
    setPluginConfig(CTX_1, LPCV_PLUGIN_ID, LPCV_KEY, 'en')
    setPluginConfig(CTX_1, LPCV_PLUGIN_ID, 'other-key', 'should-not-appear')
    await Promise.resolve()
    const values = listPluginConfigValues(LPCV_PLUGIN_ID, LPCV_KEY)
    expect(values).toEqual(['en'])
    expect(values).not.toContain('should-not-appear')
  })

  test('returns empty array when key is not set in any context', () => {
    const values = listPluginConfigValues(LPCV_PLUGIN_ID, LPCV_KEY)
    expect(values).toEqual([])
  })

  test('filters out empty and whitespace-only stored values', async () => {
    setPluginConfig(CTX_1, LPCV_PLUGIN_ID, LPCV_KEY, 'en')
    setPluginConfig(CTX_2, LPCV_PLUGIN_ID, LPCV_KEY, '   ')
    await Promise.resolve()
    const values = listPluginConfigValues(LPCV_PLUGIN_ID, LPCV_KEY)
    expect(values).toEqual(['en'])
  })
})
