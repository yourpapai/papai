// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig } from './cache.js'
import { getConfig } from './config.js'
import type { LlmOrchestratorDeps } from './llm-orchestrator-types.js'

const taskProviderEnv = process.env['TASK_PROVIDER']
const TASK_PROVIDER = taskProviderEnv ?? 'kaneo'

export interface LlmConfig {
  llmApiKey: string
  llmBaseUrl: string
  mainModel: string
}

const readConfig = (
  contextId: string,
  key: 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'kaneo_apikey' | 'youtrack_token' | 'timezone',
): string | null => {
  const value = getConfig(contextId, key)
  if (value !== null) return value
  return getCachedConfig(contextId, key)
}

export const checkRequiredConfig = (contextId: string, deps: LlmOrchestratorDeps): string[] => {
  const llmKeys = ['llm_apikey', 'llm_baseurl', 'main_model'] as const
  const missingLlmKeys = llmKeys.filter((key) => readConfig(contextId, key) === null)

  if (TASK_PROVIDER === 'youtrack') {
    const youtrackKeys = ['youtrack_token'] as const
    return [...missingLlmKeys, ...youtrackKeys.filter((key) => readConfig(contextId, key) === null)]
  }

  const kaneoKeys = ['kaneo_apikey'] as const
  const missingProviderKeys = kaneoKeys.filter((key) => readConfig(contextId, key) === null)
  const missingWorkspace = deps.getKaneoWorkspace(contextId) === null ? ['workspaceId'] : []
  return [...missingLlmKeys, ...missingProviderKeys, ...missingWorkspace]
}

export const getLlmConfig = (contextId: string): LlmConfig => ({
  llmApiKey: readConfig(contextId, 'llm_apikey')!,
  llmBaseUrl: readConfig(contextId, 'llm_baseurl')!,
  mainModel: readConfig(contextId, 'main_model')!,
})

export const resolveConfigId = (contextId: string, configContextId: string | undefined): string => {
  if (configContextId !== undefined) return configContextId
  return contextId
}

export const resolveTimezone = (configId: string): string => {
  const configuredTimezone = readConfig(configId, 'timezone')
  if (configuredTimezone !== null) return configuredTimezone
  return 'UTC'
}
