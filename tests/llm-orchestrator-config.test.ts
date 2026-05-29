// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../src/cache.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import {
  checkRequiredProviderConfig,
  getLlmConfig,
  resolveConfigId,
  resolveTimezone,
} from '../src/llm-orchestrator-config.js'
import { setSystemConfig } from '../src/system-config.js'
import {
  mockLogger,
  resetSystemConfigCacheForTesting,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

// Use youtrack for builtin provider tests since kaneo is now plugin-contributed
const assignYoutrackContext = (contextId: string): void => {
  insertTaskInstance({
    id: `${contextId}-yt`,
    type: 'youtrack',
    config: { url: 'https://youtrack.invalid' },
    status: 'active',
  })
  setContextSettings({ contextId, taskInstanceId: `${contextId}-yt`, platformInstanceId: 'telegram-default' })
}

describe('llm-orchestrator-config', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    resetSystemConfigCacheForTesting()
  })

  describe('getLlmConfig', () => {
    test('reads from system_config', () => {
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'main-system', 'env')

      expect(getLlmConfig()).toEqual({
        llmApiKey: 'sk-system',
        llmBaseUrl: 'https://api/v1',
        mainModel: 'main-system',
      })
    })

    test('throws when llm_apikey is missing', () => {
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'main-system', 'env')

      expect(() => getLlmConfig()).toThrow()
    })

    test('throws when llm_baseurl is missing', () => {
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('main_model', 'main-system', 'env')

      expect(() => getLlmConfig()).toThrow()
    })

    test('throws when main_model is missing', () => {
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')

      expect(() => getLlmConfig()).toThrow()
    })

    test('does not consult per-user config', () => {
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'main-system', 'env')

      // Even with per-user LLM keys cached, the central value wins.
      setCachedConfig('user-1', 'llm_apikey', 'sk-user-override')

      expect(getLlmConfig()).toEqual({
        llmApiKey: 'sk-system',
        llmBaseUrl: 'https://api/v1',
        mainModel: 'main-system',
      })
    })
  })

  describe('checkRequiredProviderConfig', () => {
    test('with youtrack: returns only missing provider keys when system_config is set', () => {
      assignYoutrackContext('user-1')
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'main-system', 'env')

      const missing = checkRequiredProviderConfig('user-1')
      expect(missing).toEqual(['youtrack_token'])
    })

    test('with youtrack: ignores workspace when visible credentials are present', () => {
      assignYoutrackContext('user-1')
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'main-system', 'env')

      setCachedConfig('user-1', 'youtrack_token', 'perm:tok')

      const missing = checkRequiredProviderConfig('user-1')
      expect(missing).toEqual([])
    })

    test('returns no LLM keys even when system_config is missing', () => {
      assignYoutrackContext('user-1')
      // checkRequiredProviderConfig is provider-only; system config completeness
      // is checked separately at the orchestrator entry point.
      setCachedConfig('user-1', 'youtrack_token', 'perm:tok')

      const missing = checkRequiredProviderConfig('user-1')
      expect(missing).not.toContain('llm_apikey')
      expect(missing).not.toContain('llm_baseurl')
      expect(missing).not.toContain('main_model')
    })

    test('returns an empty list when provider config is complete', () => {
      assignYoutrackContext('user-1')
      setCachedConfig('user-1', 'youtrack_token', 'perm:tok')

      const missing = checkRequiredProviderConfig('user-1')
      expect(missing).toEqual([])
    })
  })

  describe('resolveConfigId', () => {
    test('returns configContextId when provided', () => {
      expect(resolveConfigId('group-1', 'group-config-1')).toBe('group-config-1')
    })

    test('returns contextId when configContextId is undefined', () => {
      expect(resolveConfigId('dm-user-1', undefined)).toBe('dm-user-1')
    })
  })

  describe('resolveTimezone', () => {
    test('returns configured timezone for the configId', () => {
      setCachedConfig('user-1', 'timezone', 'America/New_York')
      expect(resolveTimezone('user-1')).toBe('America/New_York')
    })

    test('returns UTC when no timezone is set', () => {
      expect(resolveTimezone('user-no-tz')).toBe('UTC')
    })
  })
})
