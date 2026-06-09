// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  AI_OUTPUT_DETAIL_LEVEL_KEY,
  AI_REASONING_VISIBILITY_KEY,
  AI_TOOL_VISIBILITY_KEY,
} from './ai-output-settings.js'
import { getContextSettings } from './instances/context-store.js'
import { getTaskInstance } from './instances/task-store.js'
import { pluginRegistry } from './plugins/registry.js'
import { getTaskProviderDescriptor, listTaskProviderTypes } from './providers/registry.js'
import { isAllowedDynamicConfigKey, KANEO_PLUGIN_WORKSPACE_KEY, type ConfigField } from './types/config.js'

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

const AI_OUTPUT_FIELDS: readonly ConfigField[] = [
  {
    key: 'ai_tool_visibility',
    storageKey: AI_TOOL_VISIBILITY_KEY,
    label: 'Show tool calls',
    required: false,
    sensitive: false,
    kind: 'ai-output',
    control: 'toggle',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
  {
    key: 'ai_reasoning_visibility',
    storageKey: AI_REASONING_VISIBILITY_KEY,
    label: 'Show reasoning',
    required: false,
    sensitive: false,
    kind: 'ai-output',
    control: 'toggle',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
  {
    key: 'ai_output_detail_level',
    storageKey: AI_OUTPUT_DETAIL_LEVEL_KEY,
    label: 'Detail level',
    required: false,
    sensitive: false,
    kind: 'ai-output',
    control: 'select',
    options: [
      { value: 'sanitized', label: 'Sanitized' },
      { value: 'raw', label: 'Raw' },
    ],
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
  if (settings === null) return [...pluginFields, ...PREFERENCE_FIELDS, ...AI_OUTPUT_FIELDS]

  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.status !== 'active')
    return [...pluginFields, ...PREFERENCE_FIELDS, ...AI_OUTPUT_FIELDS]

  const descriptor = getTaskProviderDescriptor(instance.type)
  if (descriptor === undefined) return [...pluginFields, ...PREFERENCE_FIELDS, ...AI_OUTPUT_FIELDS]

  const providerFields = descriptor.contextConfigSchema
    .map(
      (field): ConfigField => ({
        key: field.key,
        storageKey: storageKeyForProviderField(descriptor, field),
        label: field.label,
        required: field.required,
        sensitive: field.sensitive,
        kind: 'provider-context',
      }),
    )
    .filter((field) => field.storageKey !== KANEO_PLUGIN_WORKSPACE_KEY)

  return [...providerFields, ...pluginFields, ...PREFERENCE_FIELDS, ...AI_OUTPUT_FIELDS]
}

export function getConfigKeysForContext(contextId: string): readonly string[] {
  const keys = getConfigFieldsForContext(contextId)
    .map((field) => field.storageKey)
    .filter((key) => isAllowedDynamicConfigKey(key))
  return keys
}

export function getRequiredProviderConfigKeysForContext(contextId: string): string[] {
  return getConfigFieldsForContext(contextId)
    .filter((field) => field.required && field.kind !== 'preference' && field.kind !== 'ai-output')
    .map((field) => field.storageKey)
}

export function isSensitiveProviderStorageKey(key: string): boolean {
  return listTaskProviderTypes().some((descriptor) =>
    [...descriptor.contextConfigSchema, ...descriptor.instanceConfigSchema].some(
      (field) => storageKeyForProviderField(descriptor, field) === key && field.sensitive,
    ),
  )
}
