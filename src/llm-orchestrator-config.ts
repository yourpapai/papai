// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig } from './cache.js'
import { getRequiredProviderConfigKeysForContext } from './config-keys.js'
import { getConfig, getConfigValue } from './config.js'
import { resolveEffectiveLlmConfig } from './llm-config-resolver.js'

export interface LlmConfig {
  llmApiKey: string
  llmBaseUrl: string
  mainModel: string
}

const readConfig = (contextId: string, key: 'timezone'): string | null => {
  const value = getConfig(contextId, key)
  if (value !== null) return value
  return getCachedConfig(contextId, key)
}

export const checkRequiredProviderConfig = (contextId: string): string[] => {
  const requiredKeys = getRequiredProviderConfigKeysForContext(contextId)
  return requiredKeys.filter((key) => getConfigValue(contextId, key) === null)
}

export const getLlmConfig = (configContextId = ''): LlmConfig => {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) {
    if (resolved.type === 'missing') {
      throw new Error(`${resolved.source} LLM config is incomplete: missing ${resolved.missing.join(', ')}`)
    }
    throw new Error(`${resolved.source} LLM config is unreadable: ${resolved.error}`)
  }
  return { llmApiKey: resolved.llmApiKey, llmBaseUrl: resolved.llmBaseUrl, mainModel: resolved.mainModel }
}

export const resolveConfigId = (contextId: string, configContextId: string | undefined): string => {
  if (configContextId !== undefined) return configContextId
  return contextId
}

export const resolveTimezone = (configId: string): string => {
  const configuredTimezone = readConfig(configId, 'timezone')
  if (configuredTimezone !== null) return configuredTimezone
  return 'UTC'
}
