// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { handleEditorCallback, handleEditorMessage, startEditor } from '../../src/config-editor/handlers.js'
import { getEditorSession } from '../../src/config-editor/state.js'
import { getConfigValue, getPluginConfig } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../utils/test-helpers.js'

const USER_ID = 'config-editor-test-user'

function registerActivePlugin(pluginId: string): void {
  const plugin: DiscoveredPlugin = {
    manifest: {
      id: pluginId,
      name: 'Config Editor Plugin',
      version: '1.0.0',
      description: 'Plugin config editor test',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: ['api_token'],
        taskProviderTypes: [],
      },
      permissions: [],
      defaultEnabled: true,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' }],
      providerCapabilities: [],
      providerConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: `/tmp/${pluginId}`,
    entryPoint: `/tmp/${pluginId}/index.ts`,
    manifestHash: `hash-${pluginId}`,
  }

  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
}

describe('config-editor back action', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
  })

  afterEach(() => {
    unregisterContributedTaskProviderType('plugin-tracker')
  })

  test('back removes the active session for the current user and target context', () => {
    startEditor('user-1', 'group-1', 'timezone')
    const result = handleEditorCallback('user-1', 'group-1', 'back')

    expect(result.handled).toBe(true)
    expect(getEditorSession('user-1', 'group-1')).toBeNull()
  })

  test('rejects editing a key that is not valid for the assigned context', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: USER_ID, taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })

    const result = startEditor(USER_ID, USER_ID, 'kaneo_apikey')

    expect(result.handled).toBe(true)
    expect(result.response).toBe('Config key "kaneo_apikey" is not valid for this context.')
  })

  test('saves plugin provider context credentials using the dynamic storage key', () => {
    registerContributedTaskProviderType('plugin-tracker', {
      pluginId: 'plugin-tracker',
      factory: () => createMockProvider({ name: 'plugin-tracker' }),
      capabilities: new Set(),
      displayName: 'Plugin Tracker',
      configSchema: [{ key: 'token', label: 'Plugin Token', required: true, sensitive: true, scope: 'context' }],
    })
    insertTaskInstance({
      id: 'plugin-prod',
      type: 'plugin-tracker',
      config: { baseUrl: 'https://plugin.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: USER_ID, taskInstanceId: 'plugin-prod', platformInstanceId: 'telegram-default' })

    const key = 'plugin:plugin-tracker:provider:token'
    const started = startEditor(USER_ID, USER_ID, key)
    const pending = handleEditorMessage(USER_ID, USER_ID, 'secret-token')
    const session = getEditorSession(USER_ID, USER_ID)
    const saved = handleEditorCallback(USER_ID, USER_ID, 'save', key, session?.sessionToken)

    expect(started.response).toContain('Plugin Token')
    expect(pending.response).toContain('****oken')
    expect(saved.response).toBe('✅ **Plugin Token** saved successfully.')
    expect(getConfigValue(USER_ID, key)).toBe('secret-token')
  })

  test('saves plugin-owned context config through plugin config storage', () => {
    const pluginId = 'config-editor-plugin-context'
    registerActivePlugin(pluginId)

    const key = `plugin:${pluginId}:api_token`
    const started = startEditor(USER_ID, USER_ID, key)
    const pending = handleEditorMessage(USER_ID, USER_ID, 'secret-token')
    const session = getEditorSession(USER_ID, USER_ID)
    const saved = handleEditorCallback(USER_ID, USER_ID, 'save', key, session?.sessionToken)

    expect(started.response).toContain('API Token')
    expect(pending.response).toContain('****oken')
    expect(saved.response).toBe('✅ **API Token** saved successfully.')
    expect(getPluginConfig(USER_ID, pluginId, 'api_token')).toBe('secret-token')
    const reopened = startEditor(USER_ID, USER_ID, key)
    expect(reopened.response).toContain('Current value: ****oken')
  })

  test('opening editor for a second field replaces the active session', () => {
    const userId = 'config-editor-replace-user'
    const storageContextId = 'config-editor-replace-context'
    const pluginId = 'config-editor-replace-plugin'
    const key = `plugin:${pluginId}:api_token`

    registerActivePlugin(pluginId)

    startEditor(userId, storageContextId, 'timezone')
    const result = startEditor(userId, storageContextId, key)

    expect(result.response).toContain('Edit API Token')
    expect(getEditorSession(userId, storageContextId)).toMatchObject({ editingKey: key })

    handleEditorCallback(userId, storageContextId, 'back')
  })

  test('stale save callback for the previous field does not save the current field session', () => {
    const userId = 'config-editor-stale-save-user'
    const storageContextId = 'config-editor-stale-save-context'
    const pluginId = 'config-editor-stale-save-plugin'
    const key = `plugin:${pluginId}:api_token`

    registerActivePlugin(pluginId)

    startEditor(userId, storageContextId, 'timezone')
    startEditor(userId, storageContextId, key)
    handleEditorMessage(userId, storageContextId, 'new-api-token')

    const saveResult = handleEditorCallback(userId, storageContextId, 'save', 'timezone')

    expect(saveResult).toEqual({ handled: false })
    expect(getPluginConfig(storageContextId, pluginId, 'api_token')).toBeNull()
    expect(getEditorSession(userId, storageContextId)).toMatchObject({
      editingKey: key,
      pendingValue: 'new-api-token',
    })

    handleEditorCallback(userId, storageContextId, 'back')
  })

  test('same-field stale save callback from an older session is rejected', () => {
    const userId = 'config-editor-stale-same-field-user'
    const storageContextId = 'config-editor-stale-same-field-context'

    startEditor(userId, storageContextId, 'timezone')
    handleEditorMessage(userId, storageContextId, 'UTC')
    const olderSession = getEditorSession(userId, storageContextId)

    startEditor(userId, storageContextId, 'timezone')
    handleEditorMessage(userId, storageContextId, 'Europe/Berlin')
    const activeSession = getEditorSession(userId, storageContextId)

    const result = handleEditorCallback(userId, storageContextId, 'save', 'timezone', olderSession?.sessionToken)

    expect(result).toEqual({ handled: false })
    expect(getConfigValue(storageContextId, 'timezone')).toBeNull()
    expect(getEditorSession(userId, storageContextId)).toMatchObject({
      editingKey: 'timezone',
      pendingValue: 'Europe/Berlin',
      sessionToken: activeSession?.sessionToken,
    })

    handleEditorCallback(userId, storageContextId, 'back')
  })

  test('active save callback for the current session still saves successfully', () => {
    const userId = 'config-editor-active-save-user'
    const storageContextId = 'config-editor-active-save-context'

    startEditor(userId, storageContextId, 'timezone')
    handleEditorMessage(userId, storageContextId, 'Europe/Berlin')
    const activeSession = getEditorSession(userId, storageContextId)

    const result = handleEditorCallback(userId, storageContextId, 'save', 'timezone', activeSession?.sessionToken)

    expect(result.handled).toBe(true)
    expect(result.response).toBe('✅ **Timezone** saved successfully.')
    expect(getConfigValue(storageContextId, 'timezone')).toBe('Europe/Berlin')
    expect(getEditorSession(userId, storageContextId)).toBeNull()
  })
})
