// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getCachedConfig, setCachedConfig } from '../src/cache.js'
import { getAllConfig, getConfig, isConfigKey, isSensitiveKey, maskValue, setConfig } from '../src/config.js'
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

describe('setConfig', () => {
  beforeEach(async () => {
    await setupTestDb()
    seedCommonTestPlatformInstances()
    clearUserCache(USER_A)
    clearUserCache(USER_B)
  })

  test('stores value for user and key', () => {
    setConfig(USER_A, 'kaneo_apikey', 'test-api-key')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('test-api-key')
  })

  test('updates existing value', () => {
    setConfig(USER_A, 'kaneo_apikey', 'old-key')
    setConfig(USER_A, 'kaneo_apikey', 'new-key')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('new-key')
  })

  test('isolates config between users', () => {
    setConfig(USER_A, 'kaneo_apikey', 'key-a')
    setConfig(USER_B, 'kaneo_apikey', 'key-b')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('key-a')
    expect(getConfig(USER_B, 'kaneo_apikey')).toBe('key-b')
  })

  test('handles all remaining per-user keys', () => {
    setConfig(USER_A, 'kaneo_apikey', 'value-for-kaneo_apikey')
    setConfig(USER_A, 'youtrack_token', 'value-for-youtrack_token')
    setConfig(USER_A, 'timezone', 'UTC')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('value-for-kaneo_apikey')
    expect(getConfig(USER_A, 'youtrack_token')).toBe('value-for-youtrack_token')
    expect(getConfig(USER_A, 'timezone')).toBe('UTC')
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
    setConfig(USER_A, 'kaneo_apikey', 'key-abc')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('key-abc')
  })

  test('returns null for unset key', () => {
    expect(getConfig(USER_A, 'kaneo_apikey')).toBeNull()
  })

  test('normalizes legacy timezone values on read', () => {
    setCachedConfig(USER_A, 'timezone', 'UTC+5')
    expect(getConfig(USER_A, 'timezone')).toBe('Etc/GMT-5')
  })
})

describe('isConfigKey', () => {
  test('returns true for valid per-user keys', () => {
    const validKeys: ConfigKey[] = ['kaneo_apikey', 'youtrack_token', 'timezone', 'kaneo_workspace_id']
    for (const key of validKeys) {
      expect(isConfigKey(key)).toBe(true)
    }
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
