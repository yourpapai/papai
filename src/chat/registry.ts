// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { InstanceConfig, PlatformInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import type { ChatProviderConfigField } from './provider-descriptor.js'
import type {
  ChatCapability,
  ChatProvider,
  ChatProviderDescriptor,
  ChatProviderTraits,
  ThreadCapabilities,
} from './types.js'

const log = logger.child({ scope: 'chat:registry' })

type InstanceChatProviderFactory = (id: string, config: InstanceConfig) => ChatProvider

// --- Plugin-contributed chat provider types ---

export type ContributedChatProviderEntry = {
  pluginId: string
  factory: InstanceChatProviderFactory
  capabilities: ReadonlySet<ChatCapability>
  traits: ChatProviderTraits
  threadCapabilities: ThreadCapabilities
  displayName: string
  instanceConfigSchema: readonly ChatProviderConfigField[]
}

const pluginContributedChatProviderFactories = new Map<string, ContributedChatProviderEntry>()

/** Register a plugin-contributed chat provider type. First-wins on duplicate type. */
export function registerContributedChatProviderType(type: string, entry: ContributedChatProviderEntry): void {
  const existing = pluginContributedChatProviderFactories.get(type)
  if (existing !== undefined) {
    log.error(
      { type, existing: existing.pluginId, attempted: entry.pluginId },
      'Duplicate chat provider type; keeping first registration',
    )
    return
  }
  pluginContributedChatProviderFactories.set(type, entry)
  log.info({ type, pluginId: entry.pluginId }, 'Registered contributed chat provider type')
}

/** List contributed types owned by a plugin. */
export function listContributedChatProviderTypesForPlugin(pluginId: string): string[] {
  return [...pluginContributedChatProviderFactories.entries()]
    .filter(([, entry]) => entry.pluginId === pluginId)
    .map(([type]) => type)
}

/** Remove all contributed types owned by a plugin (deactivation / failure cleanup). */
export function unregisterContributedChatProviderType(pluginId: string): string[] {
  const removedTypes: string[] = []
  for (const [type, entry] of pluginContributedChatProviderFactories) {
    if (entry.pluginId === pluginId) {
      pluginContributedChatProviderFactories.delete(type)
      removedTypes.push(type)
      log.debug({ type, pluginId }, 'Unregistered contributed chat provider type')
    }
  }
  return removedTypes
}

/** Look up a single chat-provider type descriptor. */
export function getChatProviderDescriptor(type: string): ChatProviderDescriptor | undefined {
  return listPlatformProviderTypes().find((descriptor) => descriptor.type === type)
}

/** List all available chat provider types (plugin-contributed only). */
export const listPlatformProviderTypes = (): ChatProviderDescriptor[] =>
  [...pluginContributedChatProviderFactories.entries()].map(([type, entry]) => ({
    type,
    displayName: entry.displayName,
    source: { plugin: entry.pluginId } as const,
    instanceConfigSchema: entry.instanceConfigSchema,
    contextConfigSchema: [] as readonly ChatProviderConfigField[],
    capabilities: entry.capabilities,
    traits: entry.traits,
  }))

/**
 * Create a ChatProvider instance from config.
 * All providers are now plugin-contributed; this function consults the plugin registry.
 */
export function createChatProviderFromConfig(
  id: string,
  type: PlatformInstanceType,
  config: InstanceConfig,
): ChatProvider {
  const contributed = pluginContributedChatProviderFactories.get(type)
  if (contributed !== undefined) {
    const hasBlank = contributed.instanceConfigSchema.some(
      (field) => field.required && (config[field.key] === undefined || config[field.key]!.trim() === ''),
    )
    if (hasBlank) {
      log.error({ type, id }, 'Invalid contributed chat provider instance config')
      throw new Error(`Missing ${type} instance config`)
    }
    return contributed.factory(id, config)
  }

  log.error({ type, id }, 'Unknown chat provider type')
  throw new Error(`Unknown chat provider type: ${type}`)
}
