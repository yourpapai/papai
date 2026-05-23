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
import { mockLogger, resetSystemConfigCacheForTesting, setupTestDb } from './utils/test-helpers.js'

const stubDeps = { getKaneoWorkspace: (): string => 'workspace-1' }
const stubDepsNoWorkspace = { getKaneoWorkspace: (): string | null => null }

const assignKaneoContext = (contextId: string): void => {
  insertTaskInstance({ id: `${contextId}-kaneo`, type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
  setContextSettings({ contextId, taskInstanceId: `${contextId}-kaneo`, platformInstanceId: 'telegram-default' })
}

describe('llm-orchestrator-config', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
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
    test('with kaneo: returns only missing provider keys when system_config is set', () => {
      assignKaneoContext('user-1')
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'main-system', 'env')

      const missing = checkRequiredProviderConfig('user-1', stubDeps)
      expect(missing).toEqual(['kaneo_apikey'])
    })

    test('with kaneo: ignores workspaceId because it is internal setup state', () => {
      assignKaneoContext('user-1')
      setSystemConfig('llm_apikey', 'sk-system', 'env')
      setSystemConfig('llm_baseurl', 'https://api/v1', 'env')
      setSystemConfig('main_model', 'main-system', 'env')

      setCachedConfig('user-1', 'kaneo_apikey', 'k-key')

      const missing = checkRequiredProviderConfig('user-1', stubDepsNoWorkspace)
      expect(missing).toEqual([])
    })

    test('returns no LLM keys even when system_config is missing', () => {
      assignKaneoContext('user-1')
      // checkRequiredProviderConfig is provider-only; system config completeness
      // is checked separately at the orchestrator entry point.
      setCachedConfig('user-1', 'kaneo_apikey', 'k-key')

      const missing = checkRequiredProviderConfig('user-1', stubDeps)
      expect(missing).not.toContain('llm_apikey')
      expect(missing).not.toContain('llm_baseurl')
      expect(missing).not.toContain('main_model')
    })

    test('returns an empty list when provider config is complete', () => {
      assignKaneoContext('user-1')
      setCachedConfig('user-1', 'kaneo_apikey', 'k-key')

      const missing = checkRequiredProviderConfig('user-1', stubDeps)
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
