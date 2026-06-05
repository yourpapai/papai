// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { registerContributedChatProviderType } from '../chat/registry.js'
import { logger } from '../logger.js'
import { importPluginModule } from './module-import.js'
import { pluginRegistry } from './registry.js'
import type { DiscoveredPlugin } from './types.js'

const log = logger.child({ scope: 'plugins:chat-provider-factory-registration' })

type ChatProviderFactoryFn = (id: string, config: Record<string, string>) => import('../chat/types.js').ChatProvider

const isChatProviderFactory = (value: unknown): value is ChatProviderFactoryFn => typeof value === 'function'

/**
 * Register chat provider factories from approved plugins.
 * Called before ChatRouter construction so plugin-contributed providers are available.
 * Only registers the factory (via the manifest-declared named export); does NOT run full activation.
 */
export async function registerChatProviderFactories(plugins: DiscoveredPlugin[]): Promise<void> {
  const approved = plugins.filter((p) => {
    const entry = pluginRegistry.getEntry(p.manifest.id)
    return entry !== undefined && entry.state === 'approved'
  })

  const registrations = approved
    .filter(
      (p) =>
        (p.manifest.contributes.chatProviderTypes ?? []).length > 0 && p.manifest.chatProviderFactory !== undefined,
    )
    .map((p) => registerOneChatProviderFactory(p))

  await Promise.all(registrations)
}

async function registerOneChatProviderFactory(plugin: DiscoveredPlugin): Promise<void> {
  const { manifest } = plugin
  const chatProviderTypes = manifest.contributes.chatProviderTypes ?? []
  const factoryExportName = manifest.chatProviderFactory!
  const type = chatProviderTypes[0]!

  try {
    const imported = await importPluginModule(plugin.entryPoint)
    const candidate = imported.moduleRecord[factoryExportName]
    if (!isChatProviderFactory(candidate)) {
      log.error(
        { pluginId: manifest.id, exportName: factoryExportName },
        'Chat provider factory export not found or not a function',
      )
      return
    }

    const traits = manifest.chatProviderTraits ?? { observedGroupMessages: 'all' as const }
    const threadCapabilities = manifest.chatProviderThreadCapabilities ?? {
      supportsThreads: false,
      canCreateThreads: false,
      threadScope: 'message' as const,
    }

    registerContributedChatProviderType(type, {
      pluginId: manifest.id,
      factory: candidate,
      capabilities: new Set(manifest.chatProviderCapabilities ?? []),
      traits,
      threadCapabilities,
      displayName: manifest.name,
      instanceConfigSchema: manifest.providerConfigSchema.map((field) => ({
        key: field.key,
        label: field.label,
        required: field.required,
        sensitive: field.sensitive,
        scope: 'instance' as const,
      })),
    })
    log.info({ pluginId: manifest.id, type }, 'Registered chat provider factory (early pass)')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error({ pluginId: manifest.id, error: msg }, 'Failed to register chat provider factory (early pass)')
  }
}
