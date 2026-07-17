// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { setConfigValue } from '../../../src/config.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import { discoverPlugins } from '../../../src/plugins/discovery.js'
import { activatePlugins, deactivateAllPlugins } from '../../../src/plugins/loader.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../../src/plugins/registry.js'
import { defaultTaskProviderResolver } from '../../../src/providers/resolver.js'
import { makeTools } from '../../../src/tools/index.js'
import { createMockProvider } from '../../tools/mock-provider.js'
import { mockLogger, seedCommonTestPlatformInstances, setupTestDb } from '../../utils/test-helpers.js'

// End-to-end eligibility test for the real youtrack plugin binding through the
// production `makeTools` pipeline (activation, context eligibility, mode gating) —
// as opposed to `apply-command-tool.test.ts` (unit-level tool logic) and
// `tools-integration.test.ts` (raw-provider `makeTools` surface, no plugin layer).
const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'
const YOUTRACK_TOOL = 'plugin_task_provider_youtrack__apply_youtrack_command'
const YOUTRACK_TOKEN_KEY = 'plugin:task-provider-youtrack:provider:token'
const PLUGINS_ROOT = join(process.cwd(), 'plugins')

describe('apply_youtrack_command real-plugin eligibility (production makeTools pipeline)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    await deactivateAllPlugins()

    const discovered = discoverPlugins(PLUGINS_ROOT)
    const youtrackPlugin = discovered.plugins.find((plugin) => plugin.manifest.id === YOUTRACK_PLUGIN_ID)
    if (youtrackPlugin === undefined) throw new Error('task-provider-youtrack plugin not discovered')

    pluginRegistry.registerDiscovered(youtrackPlugin)
    pluginRegistry.approve(YOUTRACK_PLUGIN_ID, 'admin-user', youtrackPlugin.manifestHash)
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())
    expect(pluginRegistry.getEntry(YOUTRACK_PLUGIN_ID)?.state).toBe('active')
  })

  afterEach(async () => {
    await deactivateAllPlugins()
  })

  test('is present when mode is normal and a youtrack instance is bound', async () => {
    insertTaskInstance({
      id: 'yt-normal',
      type: 'youtrack',
      config: { baseUrl: 'https://yt.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'ctx-yt-normal',
      taskInstanceId: 'yt-normal',
      platformInstanceId: 'telegram-default',
    })
    setConfigValue('ctx-yt-normal', YOUTRACK_TOKEN_KEY, 'perm:abc')
    setPluginEnabledForContext(YOUTRACK_PLUGIN_ID, 'ctx-yt-normal', true)

    const provider = await defaultTaskProviderResolver.resolve('ctx-yt-normal')
    expect(provider).not.toBeNull()

    const tools = await makeTools(provider!, {
      storageContextId: 'ctx-yt-normal',
      chatUserId: 'user-1',
      contextType: 'dm',
      mode: 'normal',
    })

    expect(tools).toHaveProperty(YOUTRACK_TOOL)
  })

  test('is absent in proactive mode even with a youtrack instance bound', async () => {
    insertTaskInstance({
      id: 'yt-proactive',
      type: 'youtrack',
      config: { baseUrl: 'https://yt.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'ctx-yt-proactive',
      taskInstanceId: 'yt-proactive',
      platformInstanceId: 'telegram-default',
    })
    setConfigValue('ctx-yt-proactive', YOUTRACK_TOKEN_KEY, 'perm:abc')
    setPluginEnabledForContext(YOUTRACK_PLUGIN_ID, 'ctx-yt-proactive', true)

    const provider = await defaultTaskProviderResolver.resolve('ctx-yt-proactive')
    expect(provider).not.toBeNull()

    const tools = await makeTools(provider!, {
      storageContextId: 'ctx-yt-proactive',
      chatUserId: 'user-1',
      contextType: 'dm',
      mode: 'proactive',
    })

    expect(tools).not.toHaveProperty(YOUTRACK_TOOL)
  })

  test('is absent when the bound provider does not support commands (kaneo)', async () => {
    insertTaskInstance({ id: 'kaneo-1', type: 'kaneo', config: { baseUrl: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({
      contextId: 'ctx-kaneo',
      taskInstanceId: 'kaneo-1',
      platformInstanceId: 'telegram-default',
    })
    setPluginEnabledForContext(YOUTRACK_PLUGIN_ID, 'ctx-kaneo', true)

    const kaneoProvider = createMockProvider({ name: 'kaneo' })
    const tools = await makeTools(kaneoProvider, {
      storageContextId: 'ctx-kaneo',
      chatUserId: 'user-1',
      contextType: 'dm',
      mode: 'normal',
    })

    expect(tools).not.toHaveProperty(YOUTRACK_TOOL)
  })
})
