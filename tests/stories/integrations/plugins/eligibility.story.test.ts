// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { contributionRegistry } from '../../../../src/plugins/contributions.js'
import { discoverPlugins } from '../../../../src/plugins/discovery.js'
import { getActivatedPluginIds } from '../../../../src/plugins/loader.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../../../src/plugins/types.js'
import { buildProviderlessToolDescriptors } from '../../../../src/tools/index.js'
import { executeScenario } from '../../harness/scenario.js'

const BASE_PLUGIN_ID = 'synthetic-web-search'
const CONSTRAINED_PLUGIN_ID = 'synthetic-needs-user-resolution'
const TOOL_NAME = 'plugin_synthetic_web_search__search'

function discovered(pluginId: string): DiscoveredPlugin {
  const plugin = discoverPlugins('plugins').plugins.find(({ manifest }) => manifest.id === pluginId)
  if (plugin === undefined) throw new Error(`Expected discovered plugin ${pluginId}`)
  return plugin
}

function capabilityConstrainedClone(source: DiscoveredPlugin): DiscoveredPlugin {
  return {
    ...source,
    manifestHash: 'scenario-synthetic-needs-user-resolution',
    manifest: {
      ...source.manifest,
      id: CONSTRAINED_PLUGIN_ID,
      name: 'Synthetic Search Requiring User Resolution',
      requiredChatCapabilities: ['users.resolve'],
    },
  }
}

async function toolNames(contextId: string, chatUserId: string): Promise<readonly string[]> {
  const tools = await buildProviderlessToolDescriptors({
    storageContextId: contextId,
    chatUserId,
    username: chatUserId,
    contextType: 'dm',
  })
  return Object.keys(tools)
}

test('real plugin lifecycle evaluates context state and leaves no contribution leakage', async () => {
  await executeScenario('plugin context eligibility', async ({ given, world }) => {
    const alice = given.user('alice')
    const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
    const synthetic = discovered(BASE_PLUGIN_ID)
    const constrained = capabilityConstrainedClone(synthetic)
    given.plugin(synthetic)
    given.plugin(constrained)
    setPluginAdminConfig(BASE_PLUGIN_ID, 'api_key', 'synthetic-private-key', 'scenario-admin')
    setPluginAdminConfig(CONSTRAINED_PLUGIN_ID, 'api_key', 'synthetic-private-key', 'scenario-admin')
    setPluginEnabledForContext(BASE_PLUGIN_ID, contextId, true)
    setPluginEnabledForContext(CONSTRAINED_PLUGIN_ID, contextId, false)
    setPluginEnabledForContext(CONSTRAINED_PLUGIN_ID, contextId, true)

    await world.start()

    expect(getActivatedPluginIds()).toContain(BASE_PLUGIN_ID)
    expect(contributionRegistry.getContributions(BASE_PLUGIN_ID)?.tools.map(({ name }) => name)).toContain('search')
    expect(await toolNames(contextId, alice.id)).toContain(TOOL_NAME)

    setPluginEnabledForContext(BASE_PLUGIN_ID, contextId, false)
    expect(await toolNames(contextId, alice.id)).not.toContain(TOOL_NAME)

    setPluginEnabledForContext(BASE_PLUGIN_ID, contextId, true)
    expect(await toolNames(contextId, alice.id)).toContain(TOOL_NAME)
    expect(pluginRegistry.getEntry(CONSTRAINED_PLUGIN_ID)?.state).toBe('incompatible')
    expect(getActivatedPluginIds()).not.toContain(CONSTRAINED_PLUGIN_ID)
    expect(contributionRegistry.getContributions(CONSTRAINED_PLUGIN_ID)).toBeUndefined()
    expect(JSON.stringify(world.events.all())).not.toContain('synthetic-private-key')
  })

  expect(getActivatedPluginIds()).toEqual([])
  expect(contributionRegistry.getContributions(BASE_PLUGIN_ID)).toBeUndefined()

  await executeScenario('plugin isolation after lifecycle', async ({ given, world }) => {
    const bob = given.user('bob')
    const contextId = toScopedContextId({ platformInstanceId: bob.platformInstanceId, nativeContextId: bob.id })
    await world.start()
    expect(getActivatedPluginIds()).not.toContain(BASE_PLUGIN_ID)
    expect(await toolNames(contextId, bob.id)).not.toContain(TOOL_NAME)
  })
})
