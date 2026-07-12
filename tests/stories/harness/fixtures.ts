// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { addAuthorizedGroup, setGuestMode } from '../../../src/authorized-groups.js'
import { addGroupMember } from '../../../src/groups.js'
import { setIdentityMapping } from '../../../src/identity/mapping.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import type { PlatformInstanceType } from '../../../src/instances/types.js'
import { pluginRegistry } from '../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../src/plugins/types.js'
import {
  createProvider,
  getTaskProviderDescriptor,
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../../src/providers/registry.js'
import type { TaskProvider } from '../../../src/providers/types.js'
import { setSystemConfig } from '../../../src/system-config.js'
import { addUser } from '../../../src/users.js'
import {
  resetSystemConfigCacheForTesting,
  seedTestPlatformInstance,
  seedTestTaskInstance,
  setupTestDb,
} from '../../utils/test-helpers.js'
import { MemoryTaskProvider } from './memory-task-provider.js'

export const SCENARIO_PLATFORM_INSTANCE_ID = 'scenario-platform'
export const SCENARIO_TASK_INSTANCE_ID = 'scenario-tasks'
export const SCENARIO_CONTEXT_ID = 'scenario-context'
export const SCENARIO_GROUP_ID = 'scenario-group'
export const SCENARIO_USER_ID = 'scenario-user'
export const SCENARIO_PROVIDER_PLUGIN_ID = 'scenario-memory-provider'

const SCENARIO_PLUGIN: DiscoveredPlugin = {
  manifest: {
    id: 'scenario-approved-plugin',
    name: 'Scenario Approved Plugin',
    version: '1.0.0',
    description: 'Hermetic scenario plugin approval fixture',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: [],
    },
    permissions: [],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerTraits: [],
    providerConfigSchema: [],
    providerContextConfigSchema: [],
    providerAllowedHosts: [],
  },
  pluginDir: '/scenario/plugins/scenario-approved-plugin',
  entryPoint: '/scenario/plugins/scenario-approved-plugin/index.ts',
  manifestHash: 'scenario-approved-plugin-hash',
}

export type ScenarioFixturesOptions = Readonly<{
  taskProvider?: TaskProvider
}>

export type ScenarioFixtures = Readonly<{
  taskProvider: TaskProvider
  setupDatabase(): Promise<void>
  seedPlatformInstance(input?: Readonly<{ id?: string; type?: PlatformInstanceType }>): void
  seedTaskInstance(input?: Readonly<{ id?: string; type?: string }>): void
  assignContext(input?: Readonly<{ contextId?: string; platformInstanceId?: string; taskInstanceId?: string }>): void
  authorizeUser(input?: Readonly<{ userId?: string; platformInstanceId?: string; username?: string }>): void
  authorizeGroup(input?: Readonly<{ groupId?: string }>): void
  enableGuestMode(groupId: string): void
  addGroupMember(input?: Readonly<{ groupId?: string; userId?: string }>): void
  seedIdentity(
    input: Readonly<{
      userId: string
      providerName: string
      providerUserId: string
      login: string
      displayName: string
    }>,
  ): void
  seedSystemLlmConfig(input?: Readonly<{ apiKey?: string; baseUrl?: string; mainModel?: string }>): void
  approvePlugin(plugin?: DiscoveredPlugin): DiscoveredPlugin
  registerTaskProvider(): void
  teardown(): void
}>

export function createScenarioFixtures(options: ScenarioFixturesOptions = {}): ScenarioFixtures {
  const taskProvider = options.taskProvider ?? new MemoryTaskProvider()

  const teardown = (): void => {
    unregisterContributedTaskProviderType(SCENARIO_PROVIDER_PLUGIN_ID)
    pluginRegistry.clearForTesting()
  }

  return {
    taskProvider,
    async setupDatabase(): Promise<void> {
      teardown()
      await setupTestDb()
      resetSystemConfigCacheForTesting()
    },
    seedPlatformInstance(input = {}): void {
      seedTestPlatformInstance({ id: input.id ?? SCENARIO_PLATFORM_INSTANCE_ID, type: input.type ?? 'telegram' })
    },
    seedTaskInstance(input = {}): void {
      seedTestTaskInstance({ id: input.id ?? SCENARIO_TASK_INSTANCE_ID, type: input.type ?? 'kaneo', config: {} })
    },
    assignContext(input = {}): void {
      setContextSettings({
        contextId: input.contextId ?? SCENARIO_CONTEXT_ID,
        platformInstanceId: input.platformInstanceId ?? SCENARIO_PLATFORM_INSTANCE_ID,
        taskInstanceId: input.taskInstanceId ?? SCENARIO_TASK_INSTANCE_ID,
      })
    },
    authorizeUser(input = {}): void {
      addUser({
        userId: input.userId ?? SCENARIO_USER_ID,
        platformInstanceId: input.platformInstanceId ?? SCENARIO_PLATFORM_INSTANCE_ID,
        addedBy: 'scenario-admin',
        username: input.username,
      })
    },
    authorizeGroup(input = {}): void {
      addAuthorizedGroup(input.groupId ?? SCENARIO_GROUP_ID, 'scenario-admin')
    },
    enableGuestMode(groupId): void {
      setGuestMode(groupId, true)
    },
    addGroupMember(input = {}): void {
      addGroupMember(input.groupId ?? SCENARIO_GROUP_ID, input.userId ?? SCENARIO_USER_ID, 'scenario-admin')
    },
    seedIdentity(input): void {
      setIdentityMapping({
        contextId: input.userId,
        providerName: input.providerName,
        providerUserId: input.providerUserId,
        providerUserLogin: input.login,
        displayName: input.displayName,
        matchMethod: 'manual_nl',
        confidence: 1,
      })
    },
    seedSystemLlmConfig(input = {}): void {
      setSystemConfig('llm_apikey', input.apiKey ?? 'scenario-api-key', 'scenario-admin')
      setSystemConfig('llm_baseurl', input.baseUrl ?? 'https://llm.invalid/v1', 'scenario-admin')
      setSystemConfig('main_model', input.mainModel ?? 'scenario-main-model', 'scenario-admin')
    },
    approvePlugin(plugin = SCENARIO_PLUGIN): DiscoveredPlugin {
      pluginRegistry.registerDiscovered(plugin)
      const approved = pluginRegistry.approve(plugin.manifest.id, 'scenario-admin', plugin.manifestHash)
      if (!approved) throw new Error(`Failed to approve scenario plugin: ${plugin.manifest.id}`)
      return plugin
    },
    registerTaskProvider(): void {
      unregisterContributedTaskProviderType(SCENARIO_PROVIDER_PLUGIN_ID)
      registerContributedTaskProviderType('kaneo', {
        pluginId: SCENARIO_PROVIDER_PLUGIN_ID,
        factory: () => taskProvider,
        capabilities: taskProvider.capabilities,
        traits: taskProvider.traits,
        displayName: 'Scenario Memory Provider',
        instanceConfigSchema: [],
        contextConfigSchema: [],
      })
      const descriptor = getTaskProviderDescriptor('kaneo')
      const owner = descriptor?.source === 'builtin' ? 'builtin' : descriptor?.source.plugin
      if (owner !== SCENARIO_PROVIDER_PLUGIN_ID) {
        throw new Error(`Hermetic task provider registration failed: type 'kaneo' is owned by plugin '${owner}'`)
      }
      if (createProvider('kaneo', {}) !== taskProvider) {
        unregisterContributedTaskProviderType(SCENARIO_PROVIDER_PLUGIN_ID)
        throw new Error("Hermetic task provider registration failed: type 'kaneo' did not resolve the world provider")
      }
    },
    teardown,
  }
}
