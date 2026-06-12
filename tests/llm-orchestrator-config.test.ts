// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { setCachedConfig } from '../src/cache.js'
import { setConfigValue } from '../src/config.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import { checkRequiredProviderConfig, resolveConfigId, resolveTimezone } from '../src/llm-orchestrator-config.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../src/providers/registry.js'
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
