// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Configuration types shared between production and tests.
 */

// Task-tracker specific config keys.
// Note: kaneo_workspace_id is auto-provisioned and not user-visible.
export type TaskProviderConfigKey = 'kaneo_apikey' | 'kaneo_workspace_id' | 'youtrack_token'
export const KANEO_WORKSPACE_CONFIG_KEY = 'kaneo_workspace_id' satisfies TaskProviderConfigKey

// User preference config keys (always available)
export type PreferenceConfigKey = 'timezone'

// MCP endpoint config keys
export type McpConfigKey = 'mcp_endpoints'

// All per-user config keys. LLM credentials live in `system_config` (see
// `src/system-config.ts`) and are owned by the bot admin, not per-user.
export type ConfigKey = TaskProviderConfigKey | PreferenceConfigKey | McpConfigKey

// All valid config keys (not filtered by provider)
// Note: kaneo_workspace_id is auto-provisioned and stored separately
export const ALL_CONFIG_KEYS: readonly ConfigKey[] = [
  'kaneo_apikey',
  KANEO_WORKSPACE_CONFIG_KEY,
  'youtrack_token',
  'timezone',
  'mcp_endpoints',
]

/**
 * Check if a string is a valid ConfigKey
 */
export function isConfigKey(key: string): key is ConfigKey {
  return (ALL_CONFIG_KEYS as readonly string[]).includes(key)
}
