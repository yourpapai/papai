// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { userCachesForTesting } from '../../src/cache.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { handleToolToggleInteraction } from '../../src/chat/tool-toggle-interaction-handler.js'
import type { IncomingInteraction } from '../../src/chat/types.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { contributionRegistry } from '../../src/plugins/contributions.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../src/plugins/types.js'
import { getToolPrefs } from '../../src/tools/tool-preferences.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  createMockReply,
  mockLogger,
  seedTestPlatformInstance,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

const USER = 'tgl-user-1'
const CTX = Buffer.from(USER).toString('base64url')

function dmInteraction(callbackData: string): IncomingInteraction {
  return {
    kind: 'button',
    callbackData,
    contextId: USER,
    contextType: 'dm',
    platformInstanceId: 'telegram-default',
    storageContextId: USER,
    user: { id: USER, username: null, isAdmin: false },
  }
}

function markPluginActive(plugin: DiscoveredPlugin): void {
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
}

function registerManageableGroup(contextId: string): void {
  addAuthorizedGroup(contextId, 'admin-user')
  upsertKnownGroupContext({
    provider: 'telegram',
    contextId,
    displayName: 'Managed Group',
    parentName: null,
  })
  upsertGroupAdminObservation({
    provider: 'telegram',
    contextId,
    userId: USER,
    username: null,
    isAdmin: true,
  })
}

describe('handleToolToggleInteraction', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    userCachesForTesting.clear()
  })

  afterEach(() => {
    userCachesForTesting.delete(USER)
  })

  it('returns false for non-tgl callbacks', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction('plg:enable:x:y'), reply)
    expect(handled).toBe(false)
  })

  it('toggling a domain off persists a disabled domain for the user', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).disabledDomains).toContain('memo')
  })

  it('toggling the plugin domain off persists a disabled plugin domain for the user', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:plugin:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).disabledDomains).toContain('plugin')
  })

  it('toggling a domain off accepts a scoped personal DM target context', async () => {
    const scopedContextId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: USER })
    const scopedCtx = Buffer.from(scopedContextId).toString('base64url')
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(
      { ...dmInteraction(`tgl:dom:memo:${scopedCtx}`), storageContextId: scopedContextId },
      reply,
    )

    expect(handled).toBe(true)
    expect(getToolPrefs(scopedContextId).disabledDomains).toContain('memo')
  })

  it('rejects toggling for a context the user cannot manage', async () => {
    const { reply } = createMockReply()
    const otherCtx = Buffer.from('someone-else').toString('base64url')
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${otherCtx}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs('someone-else').disabledDomains).not.toContain('memo')
  })

  it('toggling a single tool off persists a false override for the user', async () => {
    const { reply } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:tool:delete_task:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).toolOverrides['delete_task']).toBe(false)
  })

  it('renders the drill view for tgl:open and returns handled', async () => {
    const { reply, buttonCalls } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:open:task:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(buttonCalls.length).toBeGreaterThan(0)
  })

  it('renders the plugin drill view for tgl:open instead of rejecting the domain', async () => {
    const { reply, buttonCalls, textCalls } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:open:plugin:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(buttonCalls.length).toBeGreaterThan(0)
    expect(textCalls).not.toContain('Unknown tool domain.')
  })

  it('renders eligible plugin tools in the plugin drill view', async () => {
    seedTestPlatformInstance({ id: 'telegram-default' })
    seedTestTaskInstance({ id: 'user-toggle-kaneo' })
    setContextSettings({
      contextId: USER,
      taskInstanceId: 'user-toggle-kaneo',
      platformInstanceId: 'telegram-default',
    })

    const plugin: DiscoveredPlugin = {
      manifest: {
        id: 'toggle-plugin',
        name: 'Toggle Plugin',
        version: '1.0.0',
        description: 'Toggle plugin test',
        apiVersion: PLUGIN_API_VERSION,
        main: 'index.ts',
        contributes: {
          tools: ['runtime_echo'],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
        },
        permissions: ['tasks.read'],
        defaultEnabled: false,
        activationTimeoutMs: 5000,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
      },
      pluginDir: '/tmp/toggle-plugin',
      entryPoint: '/tmp/toggle-plugin/index.ts',
      manifestHash: 'toggle-plugin-hash',
    }
    markPluginActive(plugin)
    setPluginEnabledForContext(plugin.manifest.id, USER, true)
    contributionRegistry.register(
      plugin.manifest.id,
      {
        tools: [
          {
            name: 'runtime_echo',
            description: 'Echo',
            execute: (): Promise<string> => Promise.resolve('ok'),
          },
        ],
        promptFragments: [],
      },
      plugin.manifest,
    )

    const { reply, buttonCalls } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:open:plugin:${CTX}`), reply, {
      resolveProvider: () => createMockProvider(),
    })

    expect(handled).toBe(true)
    expect(buttonCalls.at(0)).toContain('plugin_toggle_plugin__runtime_echo')

    contributionRegistry.deregister(plugin.manifest.id)
  })

  it('uses the target group context type for managed group tool menus from DM', async () => {
    const managedGroupContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: 'managed-group-1',
    })
    const encodedGroupContextId = Buffer.from(managedGroupContextId).toString('base64url')
    registerManageableGroup(managedGroupContextId)
    seedTestPlatformInstance({ id: 'telegram-default' })
    seedTestTaskInstance({ id: 'managed-group-1-kaneo' })
    setContextSettings({
      contextId: managedGroupContextId,
      taskInstanceId: 'managed-group-1-kaneo',
      platformInstanceId: 'telegram-default',
    })

    const { reply, buttonCalls } = createMockReply()
    const handled = await handleToolToggleInteraction(
      dmInteraction(`tgl:open:identity:${encodedGroupContextId}`),
      reply,
      {
        resolveProvider: () =>
          createMockProvider({
            identityResolver: {
              searchUsers: () => Promise.resolve([]),
            },
          }),
      },
    )

    expect(handled).toBe(true)
    expect(buttonCalls.at(0)).toContain('set_my_identity')
  })

  it('keeps configured DM targets in DM context when rebuilding the tool menu', async () => {
    const scopedDmContextId = toScopedContextId({
      platformInstanceId: 'telegram-default',
      nativeContextId: USER,
    })
    const encodedContextId = Buffer.from(scopedDmContextId).toString('base64url')
    seedTestPlatformInstance({ id: 'telegram-default' })
    seedTestTaskInstance({ id: 'dm-context-kaneo' })
    setContextSettings({
      contextId: scopedDmContextId,
      taskInstanceId: 'dm-context-kaneo',
      platformInstanceId: 'telegram-default',
    })

    const { reply, buttonCalls } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:open:identity:${encodedContextId}`), reply, {
      resolveProvider: () =>
        createMockProvider({
          identityResolver: {
            searchUsers: () => Promise.resolve([]),
          },
        }),
    })

    expect(handled).toBe(true)
    expect(buttonCalls.some((text) => text.includes('set_my_identity'))).toBe(false)
  })

  it('renders the domain list for tgl:back and returns handled', async () => {
    const { reply, buttonCalls } = createMockReply()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:back:${CTX}`), reply)
    expect(handled).toBe(true)
    expect(buttonCalls.length).toBeGreaterThan(0)
  })
})
