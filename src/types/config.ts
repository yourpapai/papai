// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Configuration types shared between production and tests.
 */

// Plugin-namespaced config keys for the task-provider-kaneo plugin.
// These are plain string constants (not ConfigKey union members); the flat
// legacy keys ('kaneo_apikey', 'kaneo_workspace_id') were renamed to these
// by migration 048_namespace_kaneo_config.
export const KANEO_PLUGIN_CREDENTIAL_KEY = 'plugin:task-provider-kaneo:provider:credential'
export const KANEO_PLUGIN_WORKSPACE_KEY = 'plugin:task-provider-kaneo:provider:workspaceId'

// User preference config keys (always available)
export type PreferenceConfigKey = 'timezone'

// MCP endpoint config keys
export type McpConfigKey = 'mcp_endpoints'

// Static per-user config keys. Provider-specific keys ('kaneo_apikey',
// 'kaneo_workspace_id', 'youtrack_token', etc.) are no longer part of this
// union; they are plugin-namespaced dynamic keys handled via
// setConfigValue/getConfigValue + isAllowedDynamicConfigKey.
// LLM credentials live in `system_config` (see `src/system-config.ts`)
// and are owned by the bot admin, not per-user.
export type ConfigKey = PreferenceConfigKey | McpConfigKey

export type ConfigField = {
  readonly key: string
  readonly storageKey: string
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
  readonly kind: 'preference' | 'provider-context' | 'plugin-context'
}

// All valid static config keys (preference and MCP only; provider keys are
// handled via the dynamic-config path).
export const ALL_CONFIG_KEYS: readonly ConfigKey[] = ['timezone', 'mcp_endpoints']

/**
 * Check if a string is a valid ConfigKey
 */
export function isConfigKey(key: string): key is ConfigKey {
  return (ALL_CONFIG_KEYS as readonly string[]).includes(key)
}

const PLUGIN_PROVIDER_CONFIG_KEY_PATTERN = /^plugin:[a-z0-9][a-z0-9-]*:provider:[A-Za-z0-9][A-Za-z0-9_.-]*$/u
const PLUGIN_CONTEXT_CONFIG_KEY_PATTERN = /^plugin:[a-z0-9][a-z0-9-]*:[a-z][a-z0-9_]*$/u

export function isAllowedDynamicConfigKey(key: string): boolean {
  return isConfigKey(key) || PLUGIN_PROVIDER_CONFIG_KEY_PATTERN.test(key) || PLUGIN_CONTEXT_CONFIG_KEY_PATTERN.test(key)
}
