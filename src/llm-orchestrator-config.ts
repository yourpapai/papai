// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig } from './cache.js'
import { getConfigKeysForContext } from './config-keys.js'
import { getConfig } from './config.js'
import { getSystemConfig } from './system-config.js'

export interface LlmConfig {
  llmApiKey: string
  llmBaseUrl: string
  mainModel: string
}

const readConfig = (contextId: string, key: 'kaneo_apikey' | 'youtrack_token' | 'timezone'): string | null => {
  const value = getConfig(contextId, key)
  if (value !== null) return value
  return getCachedConfig(contextId, key)
}

export const checkRequiredProviderConfig = (contextId: string): string[] => {
  const requiredKeys = getConfigKeysForContext(contextId).filter(
    (key): key is 'kaneo_apikey' | 'youtrack_token' => key === 'kaneo_apikey' || key === 'youtrack_token',
  )
  return requiredKeys.filter((key) => readConfig(contextId, key) === null)
}

export const getLlmConfig = (): LlmConfig => {
  const llmApiKey = getSystemConfig('llm_apikey')
  const llmBaseUrl = getSystemConfig('llm_baseurl')
  const mainModel = getSystemConfig('main_model')
  if (llmApiKey === null || llmBaseUrl === null || mainModel === null) {
    throw new Error('system_config is incomplete: required LLM keys are missing')
  }
  return { llmApiKey, llmBaseUrl, mainModel }
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
