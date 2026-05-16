// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Configuration types shared between production and tests.
 */

// Task-tracker specific config keys (filtered by TASK_PROVIDER env var)
// Note: kaneo_workspace_id is auto-provisioned and not user-visible in CONFIG_KEYS
export type TaskProviderConfigKey = 'kaneo_apikey' | 'kaneo_workspace_id' | 'youtrack_token'

// LLM config keys (always available)
export type LlmConfigKey = 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model' | 'embedding_model'

// User preference config keys (always available)
export type PreferenceConfigKey = 'timezone'

// All config keys
export type ConfigKey = TaskProviderConfigKey | LlmConfigKey | PreferenceConfigKey

// Get the task provider from env
const TASK_PROVIDER = process.env['TASK_PROVIDER'] ?? 'kaneo'

// User-visible config keys: shown in /config and settable via /setup
// Internal keys are intentionally excluded here
const PREFERENCE_KEYS: readonly PreferenceConfigKey[] = ['timezone']

function getConfigKeysForProvider(provider: string): readonly ConfigKey[] {
  const llmKeys: readonly LlmConfigKey[] = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model']

  if (provider === 'youtrack') {
    return [...llmKeys, 'youtrack_token', ...PREFERENCE_KEYS]
  }

  // Default to kaneo - note: kaneo_workspace_id is auto-provisioned, not user-visible
  return [...llmKeys, 'kaneo_apikey', ...PREFERENCE_KEYS]
}

// Config keys available for the current task provider (user-visible only)
export const CONFIG_KEYS: readonly ConfigKey[] = getConfigKeysForProvider(TASK_PROVIDER)

// All valid config keys (not filtered by provider)
// Note: kaneo_workspace_id is auto-provisioned and stored separately
export const ALL_CONFIG_KEYS: readonly ConfigKey[] = [
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
  'embedding_model',
  'kaneo_apikey',
  'kaneo_workspace_id',
  'youtrack_token',
  'timezone',
]

/**
 * Check if a string is a valid ConfigKey
 */
export function isConfigKey(key: string): key is ConfigKey {
  return (ALL_CONFIG_KEYS as readonly string[]).includes(key)
}
