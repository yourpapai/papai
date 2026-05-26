// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import { getCachedConfig, setCachedConfig } from '../src/cache.js'
import { getAllConfig, getConfig, isConfigKey, isSensitiveKey, maskValue, setConfig } from '../src/config.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import type { ConfigKey } from '../src/types/config.js'
import { clearUserCache } from './utils/test-cache.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const USER_A = '111'
const USER_B = '222'

const assignKaneoContext = (contextId: string): void => {
  insertTaskInstance({
    id: `${contextId}-kaneo`,
    type: 'kaneo',
    config: { url: 'https://kaneo.invalid' },
    status: 'active',
  })
  setContextSettings({
    contextId,
    taskInstanceId: `${contextId}-kaneo`,
    platformInstanceId: 'telegram-default',
  })
}

beforeEach(() => {
  mockLogger()
})

describe('setConfig', () => {
  beforeEach(async () => {
    await setupTestDb()
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

describe('getAllConfig', () => {
  beforeEach(async () => {
    await setupTestDb()
    clearUserCache(USER_A)
    clearUserCache(USER_B)
  })

  test('returns all set configs for user', () => {
    assignKaneoContext(USER_A)
    setConfig(USER_A, 'kaneo_apikey', 'key-1')
    setConfig(USER_A, 'timezone', 'UTC')
    const allConfig = getAllConfig(USER_A)
    expect(allConfig.kaneo_apikey).toBe('key-1')
    expect(allConfig.timezone).toBe('UTC')
  })

  test('normalizes timezone values in bulk config reads', () => {
    setCachedConfig(USER_A, 'timezone', 'UTC+5')
    const allConfig = getAllConfig(USER_A)
    expect(allConfig.timezone).toBe('Etc/GMT-5')
  })

  test('does not leak config from other users', () => {
    assignKaneoContext(USER_A)
    setConfig(USER_A, 'kaneo_apikey', 'key-a')
    setConfig(USER_B, 'kaneo_apikey', 'key-b')
    const configA = getAllConfig(USER_A)
    expect(configA.kaneo_apikey).toBe('key-a')
  })
})

describe('maskValue', () => {
  test('masks sensitive keys', () => {
    expect(maskValue('kaneo_apikey', 'secret-key-1234')).toBe('****1234')
    expect(maskValue('youtrack_token', 'perm:token-abcd')).toBe('****abcd')
  })

  test('returns unmasked value for non-sensitive keys', () => {
    expect(maskValue('timezone', 'America/New_York')).toBe('America/New_York')
  })

  test('handles short values for sensitive keys', () => {
    expect(maskValue('kaneo_apikey', 'ab')).toBe('****ab')
    expect(maskValue('kaneo_apikey', '')).toBe('****')
  })
})

describe('isSensitiveKey', () => {
  test('returns true for sensitive keys', () => {
    expect(isSensitiveKey('kaneo_apikey')).toBe(true)
    expect(isSensitiveKey('youtrack_token')).toBe(true)
  })

  test('returns false for non-sensitive keys', () => {
    expect(isSensitiveKey('timezone')).toBe(false)
    expect(isSensitiveKey('kaneo_workspace_id')).toBe(false)
  })
})
