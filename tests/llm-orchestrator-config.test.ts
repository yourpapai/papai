// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { enableByokForContext, updateByokLlmConfig } from '../src/byok-llm/store.js'
import { setCachedConfig } from '../src/cache.js'
import { setConfigValue } from '../src/config.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import {
  checkRequiredProviderConfig,
  getLlmConfig,
  resolveConfigId,
  resolveTimezone,
} from '../src/llm-orchestrator-config.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../src/providers/registry.js'
import { setSystemConfig } from '../src/system-config.js'
import { createMockProvider } from './tools/mock-provider.js'
import {
  mockLogger,
  resetSystemConfigCacheForTesting,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

const assignYoutrackContext = (contextId: string): void => {
  insertTaskInstance({
    id: `${contextId}-yt`,
    type: 'youtrack',
    config: { baseUrl: 'https://youtrack.invalid' },
    status: 'active',
  })
  setContextSettings({ contextId, taskInstanceId: `${contextId}-yt`, platformInstanceId: 'telegram-default' })
}

describe('llm-orchestrator-config', () => {
  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
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

    test('reads BYOK config when a config context has BYOK enabled', () => {
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'main-system', 'env')
      enableByokForContext('ctx-byok', 'admin')
      updateByokLlmConfig(
        'ctx-byok',
        { llm_apikey: 'sk-byok', llm_baseurl: 'https://byok/v1', main_model: 'main-byok' },
        'user',
      )

      expect(getLlmConfig('ctx-byok')).toEqual({
        llmApiKey: 'sk-byok',
        llmBaseUrl: 'https://byok/v1',
        mainModel: 'main-byok',
      })
    })
  })

  describe('checkRequiredProviderConfig', () => {
    afterEach(() => {
      unregisterContributedTaskProviderType('plugin-tracker')
    })

    test('returns namespaced credential key when required context field is unset', () => {
      registerContributedTaskProviderType('plugin-tracker', {
        pluginId: 'plugin-tracker',
        factory: () => createMockProvider({ name: 'plugin-tracker' }),
        capabilities: new Set(),
        displayName: 'Plugin Tracker',
        instanceConfigSchema: [],
        contextConfigSchema: [
          { key: 'credential', label: 'Plugin Credential', required: true, sensitive: true, scope: 'context' },
        ],
      })
      insertTaskInstance({
        id: 'plugin-prod',
        type: 'plugin-tracker',
        config: { baseUrl: 'https://plugin.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: 'user-1',
        taskInstanceId: 'plugin-prod',
        platformInstanceId: 'telegram-default',
      })

      const missing = checkRequiredProviderConfig('user-1')
      expect(missing).toContain('plugin:plugin-tracker:provider:credential')
    })

    test('returns empty list once the required context field is set', () => {
      registerContributedTaskProviderType('plugin-tracker', {
        pluginId: 'plugin-tracker',
        factory: () => createMockProvider({ name: 'plugin-tracker' }),
        capabilities: new Set(),
        displayName: 'Plugin Tracker',
        instanceConfigSchema: [],
        contextConfigSchema: [
          { key: 'credential', label: 'Plugin Credential', required: true, sensitive: true, scope: 'context' },
        ],
      })
      insertTaskInstance({
        id: 'plugin-prod-2',
        type: 'plugin-tracker',
        config: { baseUrl: 'https://plugin.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: 'user-2',
        taskInstanceId: 'plugin-prod-2',
        platformInstanceId: 'telegram-default',
      })

      setConfigValue('user-2', 'plugin:plugin-tracker:provider:credential', 'secret-token')

      const missing = checkRequiredProviderConfig('user-2')
      expect(missing).toEqual([])
    })

    test('returns no LLM keys even when system_config is missing', () => {
      assignYoutrackContext('user-1')
      // checkRequiredProviderConfig is provider-only; system config completeness
      // is checked separately at the orchestrator entry point.
      const missing = checkRequiredProviderConfig('user-1')
      expect(missing).not.toContain('llm_apikey')
      expect(missing).not.toContain('llm_baseurl')
      expect(missing).not.toContain('main_model')
    })

    test('returns an empty list for an unassigned context', () => {
      const missing = checkRequiredProviderConfig('user-unassigned')
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
