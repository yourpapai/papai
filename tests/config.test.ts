// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach } from 'bun:test'

import {
  copyAdminLlmConfig,
  getAllConfig,
  getConfig,
  isConfigKey,
  isSensitiveKey,
  isMissingLlmConfig,
  maskValue,
  setConfig,
} from '../src/config.js'
import { CONFIG_KEYS, type ConfigKey } from '../src/types/config.js'
import { clearUserCache } from './utils/test-cache.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

const USER_A = '111'
const USER_B = '222'

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

  test('handles all config keys', () => {
    // Test LLM keys which are always available
    const llmKeys: ConfigKey[] = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model']
    llmKeys.forEach((key) => {
      setConfig(USER_A, key, `value-for-${key}`)
      expect(getConfig(USER_A, key)).toBe(`value-for-${key}`)
    })
    // Test provider-specific key (kaneo when TASK_PROVIDER not set or kaneo)
    setConfig(USER_A, 'kaneo_apikey', 'value-for-kaneo_apikey')
    expect(getConfig(USER_A, 'kaneo_apikey')).toBe('value-for-kaneo_apikey')
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
    expect(getConfig(USER_A, 'main_model')).toBeNull()
  })
})

describe('isConfigKey', () => {
  test('returns true for valid keys', () => {
    // These are always valid
    const validKeys: ConfigKey[] = ['kaneo_apikey', 'llm_apikey', 'llm_baseurl', 'main_model', 'small_model']
    validKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(true)
    })
  })

  test('returns false for invalid keys', () => {
    // These are never valid config keys
    const invalidKeys = ['invalid', 'linear', 'openai', 'token', '', 'linear_key', 'provider', 'youtrack_url']
    invalidKeys.forEach((key) => {
      expect(isConfigKey(key)).toBe(false)
    })
  })
})

describe('getAllConfig', () => {
  beforeEach(async () => {
    await setupTestDb()
    clearUserCache(USER_A)
    clearUserCache(USER_B)
  })

  test('returns all set configs for user', () => {
    setConfig(USER_A, 'kaneo_apikey', 'key-1')
    setConfig(USER_A, 'main_model', 'gpt-4')
    const allConfig = getAllConfig(USER_A)
    expect(allConfig.kaneo_apikey).toBe('key-1')
    expect(allConfig.main_model).toBe('gpt-4')
  })

  test('does not leak config from other users', () => {
    setConfig(USER_A, 'kaneo_apikey', 'key-a')
    setConfig(USER_B, 'kaneo_apikey', 'key-b')
    const configA = getAllConfig(USER_A)
    expect(configA.kaneo_apikey).toBe('key-a')
  })
})

describe('maskValue', () => {
  test('masks sensitive keys', () => {
    expect(maskValue('kaneo_apikey', 'secret-key-1234')).toBe('****1234')
    expect(maskValue('llm_apikey', 'sk-abc123')).toBe('****c123')
  })

  test('returns unmasked value for non-sensitive keys', () => {
    expect(maskValue('main_model', 'gpt-4')).toBe('gpt-4')
    expect(maskValue('llm_baseurl', 'https://api.openai.com')).toBe('https://api.openai.com')
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
    expect(isSensitiveKey('llm_apikey')).toBe(true)
  })

  test('returns false for non-sensitive keys', () => {
    expect(isSensitiveKey('llm_baseurl')).toBe(false)
    expect(isSensitiveKey('main_model')).toBe(false)
    expect(isSensitiveKey('small_model')).toBe(false)
    expect(isSensitiveKey('embedding_model')).toBe(false)
    expect(isSensitiveKey('timezone')).toBe(false)
  })
})

describe('copyAdminLlmConfig', () => {
  const ADMIN_ID = 'admin-001'
  const TARGET_ID = 'target-002'

  beforeEach(async () => {
    await setupTestDb()
    clearUserCache(ADMIN_ID)
    clearUserCache(TARGET_ID)
  })

  test('copies LLM config keys from admin to target user', () => {
    setConfig(ADMIN_ID, 'llm_apikey', 'sk-admin-key')
    setConfig(ADMIN_ID, 'llm_baseurl', 'https://api.example.com/v1')
    setConfig(ADMIN_ID, 'main_model', 'gpt-4o')
    setConfig(ADMIN_ID, 'small_model', 'gpt-4o-mini')
    setConfig(ADMIN_ID, 'embedding_model', 'text-embedding-3-small')

    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBe('sk-admin-key')
    expect(getConfig(TARGET_ID, 'llm_baseurl')).toBe('https://api.example.com/v1')
    expect(getConfig(TARGET_ID, 'main_model')).toBe('gpt-4o')
    expect(getConfig(TARGET_ID, 'small_model')).toBe('gpt-4o-mini')
    expect(getConfig(TARGET_ID, 'embedding_model')).toBe('text-embedding-3-small')
  })

  test('skips keys the admin has not set', () => {
    setConfig(ADMIN_ID, 'llm_apikey', 'sk-key')
    setConfig(ADMIN_ID, 'llm_baseurl', 'https://api.example.com/v1')
    setConfig(ADMIN_ID, 'main_model', 'gpt-4o')

    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBe('sk-key')
    expect(getConfig(TARGET_ID, 'small_model')).toBeNull()
  })

  test('is a no-op when admin has no config', () => {
    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBeNull()
    expect(getConfig(TARGET_ID, 'llm_baseurl')).toBeNull()
  })

  test('does not overwrite existing target config', () => {
    setConfig(ADMIN_ID, 'llm_apikey', 'admin-key')
    setConfig(ADMIN_ID, 'main_model', 'gpt-4o')
    setConfig(TARGET_ID, 'llm_apikey', 'existing-target-key')

    copyAdminLlmConfig(TARGET_ID, ADMIN_ID)

    expect(getConfig(TARGET_ID, 'llm_apikey')).toBe('existing-target-key')
    expect(getConfig(TARGET_ID, 'main_model')).toBe('gpt-4o')
  })
})

describe('CONFIG_KEYS', () => {
  test('contains all expected keys', () => {
    // These are always available
    expect(CONFIG_KEYS).toContain('llm_apikey')
    expect(CONFIG_KEYS).toContain('llm_baseurl')
    expect(CONFIG_KEYS).toContain('main_model')
    expect(CONFIG_KEYS).toContain('small_model')
    // Provider-specific keys (depends on TASK_PROVIDER env var)
    expect(CONFIG_KEYS).toContain('kaneo_apikey')
  })

  test('has correct length', () => {
    // LLM keys (5) + provider-specific key (1) + preference keys (1) = 7
    // Internal keys (briefing_time, deadline_nudges, staleness_days) are excluded from CONFIG_KEYS
    expect(CONFIG_KEYS).toHaveLength(7)
  })
})

describe('isMissingLlmConfig', () => {
  const USER_ID = 'llm-check-001'

  beforeEach(async () => {
    await setupTestDb()
    clearUserCache(USER_ID)
  })

  test('returns true when no LLM config is set', () => {
    expect(isMissingLlmConfig(USER_ID)).toBe(true)
  })

  test('returns true when some LLM keys are missing', () => {
    setConfig(USER_ID, 'llm_apikey', 'sk-key')
    setConfig(USER_ID, 'llm_baseurl', 'https://api.example.com')
    // Missing main_model, small_model, embedding_model
    expect(isMissingLlmConfig(USER_ID)).toBe(true)
  })

  test('returns false when all LLM keys are set', () => {
    setConfig(USER_ID, 'llm_apikey', 'sk-key')
    setConfig(USER_ID, 'llm_baseurl', 'https://api.example.com')
    setConfig(USER_ID, 'main_model', 'gpt-4')
    setConfig(USER_ID, 'small_model', 'gpt-3.5')
    setConfig(USER_ID, 'embedding_model', 'text-embedding-3')
    expect(isMissingLlmConfig(USER_ID)).toBe(false)
  })
})
