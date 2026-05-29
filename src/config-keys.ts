// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextSettings } from './instances/context-store.js'
import { getTaskInstance } from './instances/task-store.js'
import { getTaskProviderDescriptor } from './providers/registry.js'
import { isConfigKey, KANEO_PLUGIN_WORKSPACE_KEY, type ConfigField, type ConfigKey } from './types/config.js'

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
  if (descriptor.source !== 'builtin') return `plugin:${descriptor.source.plugin}:provider:${field.key}`
  if (field.storageKey !== undefined) return field.storageKey
  return field.key
}

function labelForStorageKey(storageKey: string, fallback: string): string {
  if (storageKey === 'youtrack_token') return 'YouTrack Token'
  return fallback
}

export function getConfigFieldsForContext(contextId: string): readonly ConfigField[] {
  const settings = getContextSettings(contextId)
  if (settings === null) return PREFERENCE_FIELDS

  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.status !== 'active') return PREFERENCE_FIELDS

  const descriptor = getTaskProviderDescriptor(instance.type)
  if (descriptor === undefined) return PREFERENCE_FIELDS

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

  return [...providerFields, ...PREFERENCE_FIELDS]
}

export function getConfigKeysForContext(contextId: string): readonly ConfigKey[] {
  const keys = getConfigFieldsForContext(contextId)
    .map((field) => field.storageKey)
    .filter((key): key is ConfigKey => isConfigKey(key))
  return keys.length === 0 ? PREFERENCE_KEYS : keys
}
