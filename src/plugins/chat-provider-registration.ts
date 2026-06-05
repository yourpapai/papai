// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ActivationGuard } from './registration-support.js'
import type { ChatProviderFactory, PluginContributions } from './runtime-types.js'
import type { PluginManifest } from './types.js'

export function buildRegisterChatProviderType(
  manifest: PluginManifest,
  collected: PluginContributions,
  activationGuard: ActivationGuard,
): (type: string, input: ChatProviderFactory | { factory: ChatProviderFactory }) => void {
  return function registerChatProviderType(
    type: string,
    input: ChatProviderFactory | { factory: ChatProviderFactory },
  ): void {
    activationGuard.assertOpen()
    if (!manifest.permissions.includes('provider.chat')) {
      throw new Error(`Plugin ${manifest.id} cannot register a chat provider type without 'provider.chat'`)
    }
    const declared = manifest.contributes.chatProviderTypes ?? []
    if (declared.length !== 1 || declared[0] !== type) {
      throw new Error(
        `Chat provider type '${type}' is not declared in plugin manifest contributes.chatProviderTypes (declared: [${declared.join(', ')}])`,
      )
    }
    if (collected.chatProviderRegistration !== undefined) {
      throw new Error(`Chat provider type '${type}' was registered more than once`)
    }
    const factory = typeof input === 'function' ? input : input.factory
    const traits = manifest.chatProviderTraits ?? { observedGroupMessages: 'all' as const }
    const threadCapabilities = manifest.chatProviderThreadCapabilities ?? {
      supportsThreads: false,
      canCreateThreads: false,
      threadScope: 'message' as const,
    }
    collected.chatProviderRegistration = {
      type,
      factory,
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
    }
  }
}
