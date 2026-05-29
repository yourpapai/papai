// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextSettings } from './instances/context-store.js'
import { getTaskInstance } from './instances/task-store.js'
import { pluginRegistry } from './plugins/registry.js'
import { getTaskProviderDescriptor } from './providers/registry.js'
import {
  isAllowedDynamicConfigKey,
  KANEO_PLUGIN_WORKSPACE_KEY,
  type ConfigField,
  type ConfigKey,
} from './types/config.js'

const PREFERENCE_KEYS: readonly ConfigKey[] = ['timezone', 'mcp_endpoints']
const PREFERENCE_FIELDS: readonly ConfigField[] = [
  {
    key: 'timezone',
    storageKey: 'timezone',
    label: 'Timezone',
    required: true,
    sensitive: false,
    kind: 'preference',
  },
  {
    key: 'mcp_endpoints',
    storageKey: 'mcp_endpoints',
    label: 'MCP Endpoints',
    required: false,
    sensitive: false,
    kind: 'preference',
  },
]

const storageKeyForProviderField = (
  descriptor: NonNullable<ReturnType<typeof getTaskProviderDescriptor>>,
  field: NonNullable<ReturnType<typeof getTaskProviderDescriptor>>['contextConfigSchema'][number],
): string => {
  if (descriptor.source !== 'builtin')
    return `plugin:${descriptor.source.plugin}:provider:${field.storageKey ?? field.key}`
  if (field.storageKey !== undefined) return field.storageKey
  return field.key
}

function labelForStorageKey(storageKey: string, fallback: string): string {
  if (storageKey === 'youtrack_token') return 'YouTrack Token'
  return fallback
}

function getPluginContextFields(): readonly ConfigField[] {
  return pluginRegistry.getAllEntries().flatMap((entry) => {
    if (entry.state !== 'active') return []

    const editableKeys = new Set(entry.discoveredPlugin.manifest.contributes.configKeys)
    return entry.discoveredPlugin.manifest.configRequirements.flatMap((requirement) => {
      if (requirement.scope !== 'context') return []
      if (!editableKeys.has(requirement.key)) return []
      return [
        {
          key: requirement.key,
          storageKey: `plugin:${entry.discoveredPlugin.manifest.id}:${requirement.key}`,
          label: requirement.label,
          required: requirement.required,
          sensitive: requirement.sensitive,
          kind: 'plugin-context' as const,
        },
      ]
    })
  })
}

export function getConfigFieldsForContext(contextId: string): readonly ConfigField[] {
  const pluginFields = getPluginContextFields()
  const settings = getContextSettings(contextId)
  if (settings === null) return [...pluginFields, ...PREFERENCE_FIELDS]

  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.status !== 'active') return [...pluginFields, ...PREFERENCE_FIELDS]

  const descriptor = getTaskProviderDescriptor(instance.type)
  if (descriptor === undefined) return [...pluginFields, ...PREFERENCE_FIELDS]

  const providerFields = descriptor.contextConfigSchema
    .map(
      (field): ConfigField => ({
        key: field.key,
        storageKey: storageKeyForProviderField(descriptor, field),
        label: labelForStorageKey(storageKeyForProviderField(descriptor, field), field.label),
        required: field.required,
        sensitive: field.sensitive,
        kind: 'provider-context',
      }),
    )
    .filter((field) => field.storageKey !== KANEO_PLUGIN_WORKSPACE_KEY)

  return [...providerFields, ...pluginFields, ...PREFERENCE_FIELDS]
}

export function getConfigKeysForContext(contextId: string): readonly string[] {
  const keys = getConfigFieldsForContext(contextId)
    .map((field) => field.storageKey)
    .filter((key) => isAllowedDynamicConfigKey(key))
  return keys.length === 0 ? PREFERENCE_KEYS : keys
}
