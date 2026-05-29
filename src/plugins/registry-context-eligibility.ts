// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability } from '../chat/types.js'
import { getPluginConfig } from '../config.js'
import { getRuntimeChatRouter } from '../debug/chat-router-runtime.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import { getCapabilitiesForTaskInstance } from '../providers/registry.js'
import type { TaskCapability } from '../providers/types.js'
import type { PluginRegistryEntry } from './registry.js'
import { getPluginAdminConfig, getPluginContextState, isPluginEnabledForContext } from './store.js'
import type { DiscoveredPlugin } from './types.js'

export type PluginContextEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'inactive' | 'disabled' }
  | { eligible: false; reason: 'config_missing'; missingKeys: readonly string[] }
  | { eligible: false; reason: 'capability_missing'; missingCapabilities: readonly string[] }

function getMissingRequiredConfigKeys(plugin: DiscoveredPlugin, contextId: string): readonly string[] {
  return plugin.manifest.configRequirements
    .filter((requirement) => requirement.required)
    .filter((requirement) => {
      if (requirement.scope === 'admin') {
        const value = getPluginAdminConfig(plugin.manifest.id, requirement.key)
        if (value === undefined) return true
        return value.trim() === ''
      }
      const value = getPluginConfig(contextId, plugin.manifest.id, requirement.key)
      if (value === null) return true
      return value.trim() === ''
    })
    .map((requirement) => requirement.key)
}

const missingFromSet = <Capability extends string>(
  required: readonly Capability[],
  available: ReadonlySet<Capability>,
): readonly string[] => required.filter((capability) => !available.has(capability))

const emptyTaskCapabilities = (): ReadonlySet<TaskCapability> => new Set<TaskCapability>()

const safeTaskCapabilities = (
  taskInstance: NonNullable<ReturnType<typeof getTaskInstance>>,
): ReadonlySet<TaskCapability> => {
  try {
    return getCapabilitiesForTaskInstance(taskInstance)
  } catch {
    return emptyTaskCapabilities()
  }
}

const emptyChatCapabilities = (): ReadonlySet<ChatCapability> => new Set<ChatCapability>()

function getMissingRequiredCapabilities(plugin: DiscoveredPlugin, contextId: string): readonly string[] {
  const settings = getContextSettings(contextId)
  if (settings === null) return []

  const taskInstance = getTaskInstance(settings.taskInstanceId)
  const taskCapabilities =
    taskInstance === null || taskInstance.status !== 'active'
      ? emptyTaskCapabilities()
      : safeTaskCapabilities(taskInstance)
  const router = getRuntimeChatRouter()
  const chatCapabilities =
    router === null ? emptyChatCapabilities() : router.getPlatformInstanceCapabilities(settings.platformInstanceId)

  return [
    ...missingFromSet(plugin.manifest.requiredTaskCapabilities, taskCapabilities),
    ...missingFromSet(plugin.manifest.requiredChatCapabilities, chatCapabilities),
  ]
}

export function getPluginContextEligibilityForEntry(
  entry: PluginRegistryEntry | undefined,
  pluginId: string,
  contextId: string,
): PluginContextEligibility {
  if (entry === undefined || entry.state !== 'active') return { eligible: false, reason: 'inactive' }
  const contextState = getPluginContextState(pluginId, contextId)
  const enabled =
    contextState === undefined
      ? entry.discoveredPlugin.manifest.defaultEnabled
      : isPluginEnabledForContext(pluginId, contextId)
  if (!enabled) return { eligible: false, reason: 'disabled' }

  const missingKeys = getMissingRequiredConfigKeys(entry.discoveredPlugin, contextId)
  if (missingKeys.length > 0) return { eligible: false, reason: 'config_missing', missingKeys }

  const missingCapabilities = getMissingRequiredCapabilities(entry.discoveredPlugin, contextId)
  if (missingCapabilities.length > 0) {
    return { eligible: false, reason: 'capability_missing', missingCapabilities }
  }

  return { eligible: true }
}
